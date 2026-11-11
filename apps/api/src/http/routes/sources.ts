/** CRUD de fontes, resolução de URL, atualização manual e histórico. */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createSourceSchema,
  novelProgressSchema,
  resolveSourceSchema,
  updateSourceSchema,
  type ArticleContentDto,
  type NovelBookDto,
  type NovelChapterContentDto,
  type NovelChapterDto,
  type NovelDetailsDto,
  type NovelDownloadJobDto,
  type NovelDownloadResultDto,
  type NovelOfflineBookDetailDto,
  type NovelOfflineBookDto,
  type NovelOfflineChapterDto,
  type NovelProgressDto,
  type SourceType
} from '@hub/shared';
import { getConnector, hasConnector } from '../../connectors/registry';
import {
  loadNovelSite,
  novelDetailsFromSnapshot,
  NOVEL_CHAPTER_FRESH_MS,
  NOVEL_DETAILS_FRESH_MS
} from '../../connectors/novel';
import {
  deleteNovelCache,
  getNovelCache,
  novelChapterCacheKey,
  novelDetailsCacheKey,
  setNovelCache,
  updateNovelChapterCache,
  deleteNovelChapters,
  listOfflineChapters,
  offlineChapterIndex,
  deleteNovelCacheForSource,
  novelBookKey,
  pruneOrphanNovelChapters
} from '../../db/repositories/novel-cache';
import { translateTextTo, TRANSLATE_ALLOWED_TARGETS } from '../../lib/translate';
import { getCategory } from '../../db/repositories/categories';
import { createSource, deleteSource, deleteSources, getSource, getSourceRow, listRuns, listSources, updateSource } from '../../db/repositories/sources';
import { getSettings } from '../../db/repositories/settings';
import { findMediaByExternal } from '../../db/repositories/media';
import { ensureGgdealsSource } from '../../domain/games';
import { nowIso } from '../../lib/dates';
import { parseJson } from '../../db/mappers';
import { enqueueSource } from '../../scheduler';
import { renderPageJson } from '../../lib/headless-browser';
import { desktopExtractPort, extractViaDesktop } from '../../lib/desktop-extract';
import { fetchViaJina } from '../../lib/jina';
import {
  isManualVerificationRequested,
  isWebnovelUrl,
  liveRenderJson,
  MOBILE_USER_AGENT,
  toMobileUrl
} from '../../lib/live-browser';
import { HttpError, parseBody } from '../errors';

export const sourcesRouter = Router();

function requireConnector(type: string) {
  if (!hasConnector(type)) {
    throw new HttpError(400, `O tipo "${type}" ainda não está disponível nesta fase.`, 'not_supported');
  }
  return getConnector(type);
}

/** Impede acompanhar o mesmo filme/série/anime em duas fontes. */
function assertMediaAvailable(config: Record<string, unknown>, currentSourceId?: string): void {
  const provider = typeof config.provider === 'string' ? config.provider : '';
  const externalId = typeof config.externalId === 'string' ? config.externalId : '';
  if (!provider || !externalId) return;
  if (provider !== 'tmdb' && provider !== 'anilist') return;

  const existing = findMediaByExternal(provider, externalId);
  if (existing && existing.source_id !== currentSourceId) {
    throw new HttpError(409, `Este título já está sendo acompanhado por "${existing.title}".`, 'conflict');
  }
}

/**
 * O estado de leitura fica no config da fonte: simples de atualizar e já
 * chega ao frontend junto com o restante da fonte.
 */
function readNovelProgress(config: Record<string, unknown>): NovelProgressDto | null {
  const value = config.lastReadChapter;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.chapterId !== 'string' || typeof record.chapterName !== 'string') return null;
  return {
    chapterId: record.chapterId,
    chapterIndex: typeof record.chapterIndex === 'number' ? record.chapterIndex : null,
    chapterName: record.chapterName,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
  };
}

function novelInputFromConfig(config: Record<string, unknown>): string | null {
  if (typeof config.url === 'string' && config.url.trim()) return config.url.trim();
  if (config.provider !== 'generic' && typeof config.bookId === 'string' && config.bookId.trim()) {
    const locale = typeof config.locale === 'string' && config.locale.trim() ? config.locale.trim() : 'pt';
    return `https://www.webnovel.com/${locale}/book/${config.bookId.trim()}`;
  }
  return null;
}

sourcesRouter.get('/sources', (_req, res) => {
  res.json({ sources: listSources() });
});

function logNovelCacheError(error: unknown): void {
  console.error(
    '[novels] falha ao atualizar cache:',
    error instanceof Error ? error.message : String(error)
  );
}

sourcesRouter.get('/sources/:id/novel', async (req, res) => {
  const row = getSourceRow(req.params.id);
  if (!row) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  if (row.type !== 'webnovel') {
    throw new HttpError(400, 'Esta fonte não é uma novel da Webnovel.', 'not_supported');
  }

  const config = parseJson<Record<string, unknown>>(row.config, {});
  const input = novelInputFromConfig(config);
  if (!input) throw new HttpError(400, 'A fonte não tem o link da novel.', 'validation');

  const cacheKey = novelDetailsCacheKey(row.id, input);
  const cached = getNovelCache<{ book: NovelBookDto; chapters: NovelChapterDto[] }>(cacheKey);
  const progress = readNovelProgress(config);

  if (cached) {
    res.json({ ...cached.data, progress });
    if (cached.expired) {
      void loadAndCacheNovelDetails(row.id, input).catch(logNovelCacheError);
    }
    return;
  }

  // Primeira abertura: espera a lista completa por alguns segundos. Se o site
  // estiver bloqueado/lento, usa a prévia mínima e continua buscando em segundo
  // plano para a próxima abertura.
  const fallback = fallbackNovelDetails(config);
  const loading = loadAndCacheNovelDetails(row.id, input);
  loading.catch(logNovelCacheError);

  if (!fallback) {
    try {
      const payload = await loading;
      res.json({ ...payload, progress });
      return;
    } catch (error) {
      throw new HttpError(
        502,
        `Não foi possível carregar os capítulos da novel. ${error instanceof Error ? error.message : String(error)}`,
        'novel_details'
      );
    }
  }

  try {
    const payload = await Promise.race([
      loading,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 12_000).unref?.();
      })
    ]);
    res.json({ ...payload, progress });
  } catch {
    res.json({ ...fallback, progress });
  }
});

async function loadAndCacheNovelDetails(
  sourceId: string,
  input: string
): Promise<{ book: NovelBookDto; chapters: NovelChapterDto[] }> {
  const snapshot = await loadNovelSite(input);
  const payload = novelDetailsFromSnapshot(snapshot);
  setNovelCache(novelDetailsCacheKey(sourceId, input), 'details', payload, NOVEL_DETAILS_FRESH_MS);
  return payload;
}

/** Prévia mínima a partir do que já está salvo na configuração da fonte. */
function fallbackNovelDetails(config: Record<string, unknown>): {
  book: NovelBookDto;
  chapters: NovelChapterDto[];
} | null {
  const title = typeof config.title === 'string' ? config.title : null;
  if (!title) return null;

  const latestRaw =
    config.latestChapter && typeof config.latestChapter === 'object'
      ? (config.latestChapter as Record<string, unknown>)
      : null;
  const latest =
    latestRaw && typeof latestRaw.id === 'string' && typeof latestRaw.name === 'string'
      ? {
          id: latestRaw.id,
          index: typeof latestRaw.index === 'number' ? latestRaw.index : null,
          name: latestRaw.name,
          publishedAt: typeof latestRaw.publishedAt === 'string' ? latestRaw.publishedAt : null,
          isVip: latestRaw.isVip === true,
          url: typeof latestRaw.url === 'string' ? latestRaw.url : null
        }
      : null;

  const tags = Array.isArray(config.tags)
    ? config.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    book: {
      bookId: typeof config.bookId === 'string' ? config.bookId : '',
      title,
      author: typeof config.author === 'string' ? config.author : null,
      coverUrl: typeof config.coverUrl === 'string' ? config.coverUrl : null,
      description: typeof config.description === 'string' ? config.description : null,
      category: typeof config.category === 'string' ? config.category : null,
      tags,
      chapterCount: typeof config.chapterCount === 'number' ? config.chapterCount : 0,
      latestChapter: latest,
      url: typeof config.url === 'string' ? config.url : ''
    },
    chapters: latest ? [latest] : []
  };
}

/** Página de verificação (Cloudflare e similares) não é conteúdo de capítulo. */
const NOVEL_CHALLENGE_RE =
  /(executando verifica[cç][aã]o de seguran[cç]a|verifica[cç][aã]o de seguran[cç]a|cf-browser-verification|just a moment\.\.\.|attention required!?\s*\|\s*cloudflare|checking your browser before accessing|enable javascript and cookies|ray id:)/i;

function isNovelChallengePage(title: string, text: string): boolean {
  // Só o começo da página: o texto do capítulo pode conter frases parecidas.
  const haystack = `${title}\n${text.slice(0, 1500)}`;
  return text.length < 20_000 && NOVEL_CHALLENGE_RE.test(haystack);
}

const CHAPTER_CONTENT_EXTRACT = `(() => {
  const selectors = [
    '.cha-words',
    '.cha-content',
    '.chapter-content',
    '.chapterContent',
    '#chapterContent',
    '.entry-content',
    '.post-content',
    '.read-content',
    '.reading-content',
    'article',
    'main'
  ];
  let el = null;
  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (candidate && (candidate.innerText || '').trim().length > 100) {
      el = candidate;
      break;
    }
  }
  el = el || document.body;
  const titleEl =
    document.querySelector('h1') ||
    document.querySelector('.cha-title') ||
    document.querySelector('.chapter-title');
  const title = titleEl && titleEl.innerText ? titleEl.innerText.trim() : document.title;
  const rawText = ((el && el.innerText ? el.innerText : '').trim()).slice(0, 500000);

  // Remove os widgets de comentários por parágrafo antes de ler o texto limpo.
  const commentSelectors = [
    '[class*="para-comment"]',
    '[class*="para_comment"]',
    '.j_para_comment_count',
    '.j_open_para_comment',
    '[data-report-uiname="paraendbubble"]',
    '.inline-comment',
    '.comment-count'
  ];
  for (const selector of commentSelectors) {
    for (const node of el.querySelectorAll(selector)) node.remove();
  }
  const text = ((el && el.innerText ? el.innerText : '').trim()).slice(0, 500000);

  return {
    title,
    text,
    textWithComments: rawText !== text ? rawText : null
  };
})()`;

interface NovelAttemptState {
  label: string;
  status: 'trying' | 'ok' | 'failed';
  message: string | null;
}

interface NovelChapterProgressState {
  url: string;
  startedAt: string;
  finishedAt: string | null;
  attempts: NovelAttemptState[];
}

const novelChapterProgress = new Map<string, NovelChapterProgressState>();
const NOVEL_PROGRESS_LIMIT = 30;

/** Último segmento da URL (ID/slug do capítulo), para conferir a página. */
function chapterSegment(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

function isSameChapter(a: string, b: string): boolean {
  const left = chapterSegment(a);
  const right = chapterSegment(b);
  return Boolean(left && right && left === right);
}

function startChapterProgress(url: string): NovelChapterProgressState {
  const state: NovelChapterProgressState = {
    url,
    startedAt: nowIso(),
    finishedAt: null,
    attempts: []
  };
  novelChapterProgress.set(url, state);
  while (novelChapterProgress.size > NOVEL_PROGRESS_LIMIT) {
    const oldest = novelChapterProgress.keys().next().value;
    if (!oldest) break;
    novelChapterProgress.delete(oldest);
  }
  return state;
}

const CHAPTER_READY_EXPRESSION = `(() => {
  const text = document.body ? document.body.innerText : '';
  if (/executando verifica|verificação de segurança|just a moment|attention required|checking your browser|ray id:/i.test(text)) {
    return false;
  }
  const selectors = [
    '.cha-words', '.cha-content', '.chapter-content', '.chapterContent',
    '#chapterContent', '.entry-content', '.post-content', '.read-content',
    '.reading-content', 'article', 'main'
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && (el.innerText || '').trim().length > 200) return true;
  }
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map((p) => (p.innerText || '').trim())
    .filter((value) => value.length > 30);
  return paragraphs.join(' ').length > 300;
})()`;

async function loadNovelChapter(
  urlKey: string,
  saveToCache = true,
  shouldAbort?: () => boolean
): Promise<NovelChapterContentDto> {
  const baseOptions = {
    url: urlKey,
    readyExpression: CHAPTER_READY_EXPRESSION,
    expression: CHAPTER_CONTENT_EXTRACT,
    shouldAbort: () => isManualVerificationRequested(urlKey) || Boolean(shouldAbort?.())
  };
  const progress = startChapterProgress(urlKey);
  type ChapterExtract = { title: string; text: string; textWithComments?: string | null };
  type ChapterRenderResult = {
    data: ChapterExtract | null;
    title: string;
    finalUrl: string;
  };

  const attempts: Array<{ label: string; run: () => Promise<ChapterRenderResult> }> =
    isWebnovelUrl(urlKey)
      ? [
          ...(desktopExtractPort()
            ? [
                {
                  label: 'feed',
                  run: () =>
                    extractViaDesktop<ChapterExtract>({
                      ...baseOptions,
                      timeoutMs: 18_000,
                      fallback: true
                    })
                }
              ]
            : []),
          {
            label: 'jina',
            run: async () => {
              const result = await fetchViaJina(urlKey);
              if (!result) throw new Error('leitor externo indisponível');
              return {
                data: { title: result.title, text: result.text },
                title: result.title,
                finalUrl: urlKey
              };
            }
          },
          {
            label: 'live',
            run: () =>
              liveRenderJson<ChapterExtract>({
                ...baseOptions,
                timeoutMs: 15_000,
                reuseCurrentPage: true
              })
          },
          {
            label: 'live-móvel',
            run: () =>
              liveRenderJson<ChapterExtract>({
                ...baseOptions,
                timeoutMs: 12_000,
                mobile: true
              })
          },
          {
            label: 'scraping',
            run: () =>
              renderPageJson<ChapterExtract>({ ...baseOptions, timeoutMs: 12_000 })
          },
          {
            label: 'scraping-móvel',
            run: () =>
              renderPageJson<ChapterExtract>({
                ...baseOptions,
                url: toMobileUrl(urlKey),
                timeoutMs: 10_000,
                userAgent: MOBILE_USER_AGENT
              })
          }
        ]
      : [
          {
            label: 'scraping',
            run: () =>
              renderPageJson<ChapterExtract>({ ...baseOptions, timeoutMs: 20_000 })
          },
          {
            label: 'jina',
            run: async () => {
              const result = await fetchViaJina(urlKey);
              if (!result) throw new Error('leitor externo indisponível');
              return {
                data: { title: result.title, text: result.text },
                title: result.title,
                finalUrl: urlKey
              };
            }
          }
        ];

  let result: ChapterRenderResult | null = null;
  const failures: string[] = [];
  let manualPause = false;
  for (const attempt of attempts) {
    if (isManualVerificationRequested(urlKey)) {
      manualPause = true;
      break;
    }
    const attemptState: NovelAttemptState = {
      label: attempt.label,
      status: 'trying',
      message: null
    };
    progress.attempts.push(attemptState);
    try {
      const candidate = await attempt.run();
      const candidateText = candidate.data?.text?.trim() ?? '';
      const candidateTitle =
        candidate.data?.title?.trim() || candidate.title || 'Capítulo';
      if (isNovelChallengePage(candidateTitle, candidateText)) {
        throw new Error('página de verificação de segurança');
      }
      if (!isSameChapter(candidate.finalUrl || urlKey, urlKey)) {
        throw new Error('a página retornou outro capítulo');
      }
      // Webnovel costuma cortar capítulos bloqueados em um teaser curto.
      const minLength = isWebnovelUrl(urlKey) ? 400 : 80;
      if (candidateText.length < minLength) {
        throw new Error(
          isWebnovelUrl(urlKey)
            ? 'conteúdo bloqueado ou não liberado (confira o login na Webnovel pelo navegador do Feed)'
            : 'conteúdo do capítulo não encontrado'
        );
      }
      attemptState.status = 'ok';
      progress.finishedAt = nowIso();
      result = candidate;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptState.status = 'failed';
      attemptState.message = message;
      failures.push(`${attempt.label}: ${message}`);
      console.warn(`[novels] capítulo ${urlKey} — ${attempt.label}: ${message}`);
    }
  }

  if (!result) {
    progress.finishedAt = nowIso();
    if (manualPause) {
      throw new Error('Leitura pausada para você concluir a verificação manual.');
    }
    throw new Error(
      `Todas as tentativas de carregar o capítulo falharam. ${failures.join(' | ')}`
    );
  }

  const text = result.data?.text?.trim() ?? '';
  const textWithComments = result.data?.textWithComments?.trim() || null;
  const title = result.data?.title?.trim() || result.title || 'Capítulo';

  const data: NovelChapterContentDto = {
    url: result.finalUrl || urlKey,
    title,
    text,
    textWithComments,
    fetchedAt: nowIso()
  };
  if (saveToCache) {
    setNovelCache(novelChapterCacheKey(urlKey), 'chapter', data, NOVEL_CHAPTER_FRESH_MS);
  }
  return data;
}

sourcesRouter.get('/novels/chapter/progress', (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!raw) {
    res.json({ progress: null });
    return;
  }
  let key = raw;
  try {
    key = new URL(raw).toString();
  } catch {
    // usa a URL como veio
  }
  res.json({ progress: novelChapterProgress.get(key) ?? null });
});

sourcesRouter.get('/novels/chapter', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!raw) throw new HttpError(400, 'Informe a URL do capítulo.', 'validation');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, 'URL de capítulo inválida.', 'validation');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, 'Use um endereço http:// ou https://.', 'validation');
  }

  const urlKey = target.toString();
  const cacheKey = novelChapterCacheKey(urlKey);
  const cached = getNovelCache<NovelChapterContentDto>(cacheKey);
  const cachedIsChallenge = cached
    ? isNovelChallengePage(cached.data.title, cached.data.text)
    : false;
  const cachedIsWrongChapter = cached
    ? !isSameChapter(cached.data.url, urlKey)
    : false;
  if (cachedIsChallenge || cachedIsWrongChapter) deleteNovelCache(cacheKey);

  const saveToCache = getSettings().novelChaptersOffline;

  if (cached && !cachedIsChallenge && !cachedIsWrongChapter) {
    res.json(cached.data);
    if (cached.expired && saveToCache) {
      void loadNovelChapter(urlKey, true).catch(logNovelCacheError);
    }
    return;
  }

  try {
    res.json(await loadNovelChapter(urlKey, saveToCache));
  } catch (error) {
    throw new HttpError(
      502,
      `Não foi possível carregar o capítulo. ${error instanceof Error ? error.message : String(error)}`,
      'novel_chapter'
    );
  }
});

/** Chave que agrupa capítulos e fontes da mesma novel. */
function offlineBookKey(url: string): string {
  return novelBookKey(url);
}

function novelOfflineBookMeta(): Map<
  string,
  { title: string; coverUrl: string | null; url: string | null }
> {
  const map = new Map<string, { title: string; coverUrl: string | null; url: string | null }>();
  for (const source of listSources()) {
    if (source.categoryId !== 'novel' && source.type !== 'webnovel') continue;
    const config = source.config ?? {};
    const rawUrl = typeof config.url === 'string' ? config.url : '';
    const bookId = typeof config.bookId === 'string' ? config.bookId.trim() : '';
    // Webnovel usa o ID numérico; outros sites usam o slug do livro.
    const key =
      bookId && /^\d+$/.test(bookId)
        ? `book:${bookId}`
        : offlineBookKey(rawUrl);
    if (!key) continue;
    map.set(key, {
      title:
        typeof config.title === 'string' && config.title.trim()
          ? config.title.trim()
          : source.name,
      coverUrl: typeof config.coverUrl === 'string' ? config.coverUrl : null,
      url: rawUrl || null
    });
  }
  return map;
}

function cleanChapterTitle(value: string): string {
  const cleaned = value
    .replace(/^(cap[íi]tulo|chapter)\s+\d+\s*[:.\-–]?\s*/i, '')
    .trim();
  return cleaned || value;
}

/** Número do capítulo a partir do título ("Capítulo 57: ..."). */
function chapterIndexFromTitle(value: string): number | null {
  const match = /^(?:cap[íi]tulo|chapter)\s+(\d+)/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function buildOfflineBooks(): NovelOfflineBookDto[] {
  const meta = novelOfflineBookMeta();
  const books = new Map<string, NovelOfflineBookDto>();
  for (const chapter of listOfflineChapters()) {
    const key = offlineBookKey(chapter.url);
    const book = books.get(key) ?? {
      bookId: key,
      title: meta.get(key)?.title ?? key.replace(/^(book|slug|host):/, ''),
      coverUrl: meta.get(key)?.coverUrl ?? null,
      url: meta.get(key)?.url ?? null,
      count: 0,
      bytes: 0
    };
    book.count += 1;
    book.bytes += chapter.bytes;
    books.set(key, book);
  }
  return [...books.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Chaves das novels que ainda existem como fonte. */
function currentNovelBookKeys(): Set<string> {
  const keys = new Set<string>();
  for (const source of listSources()) {
    if (source.categoryId !== 'novel' && source.type !== 'webnovel') continue;
    const config = source.config ?? {};
    const bookId = typeof config.bookId === 'string' ? config.bookId.trim() : '';
    if (bookId && /^\d+$/.test(bookId)) keys.add(`book:${bookId}`);
    const rawUrl = typeof config.url === 'string' ? config.url : '';
    if (rawUrl) keys.add(novelBookKey(rawUrl));
  }
  return keys;
}

/** Ao remover uma novel, apaga o cache de capítulos e a prévia dela. */
function purgeNovelSource(row: {
  id: string;
  category_id: string;
  type: string;
  config: string;
}): void {
  if (row.category_id !== 'novel' && row.type !== 'webnovel') return;
  const config = parseJson<Record<string, unknown>>(row.config, {});
  const rawUrl = typeof config.url === 'string' ? config.url : '';
  deleteNovelCacheForSource(row.id, rawUrl);
}

sourcesRouter.get('/novels/offline', (_req, res) => {
  pruneOrphanNovelChapters(currentNovelBookKeys());
  res.json({ books: buildOfflineBooks() });
});

sourcesRouter.get('/novels/offline/books/:bookId', (req, res) => {
  pruneOrphanNovelChapters(currentNovelBookKeys());
  const bookId = String(req.params.bookId);
  const book =
    buildOfflineBooks().find((entry) => entry.bookId === bookId) ?? null;
  if (!book) {
    throw new HttpError(404, 'Nenhum capítulo salvo para esta novel.', 'not_found');
  }
  const index = offlineChapterIndex();
  const chapters: NovelOfflineChapterDto[] = listOfflineChapters()
    .filter((chapter) => offlineBookKey(chapter.url) === bookId)
    .map((chapter) => {
      const extra = index.get(chapter.url);
      const rawTitle = extra?.name || chapter.title;
      return {
        url: chapter.url,
        title: cleanChapterTitle(rawTitle),
        index:
          extra?.index ??
          chapterIndexFromTitle(extra?.name ?? '') ??
          chapterIndexFromTitle(chapter.title),
        bytes: chapter.bytes,
        fetchedAt: chapter.fetchedAt,
        translatedLanguage: chapter.translatedLanguage
      };
    })
    .sort(
      (a, b) =>
        (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title)
    );
  res.json({ book, chapters } satisfies NovelOfflineBookDetailDto);
});

sourcesRouter.post('/novels/offline/delete', (req, res) => {
  const body = parseBody(
    z.object({
      urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(500)
    }),
    req.body
  );
  const deleted = deleteNovelChapters(body.urls);
  res.json({ deleted });
});

interface NovelDownloadChapterInput {
  url: string;
  name?: string;
  index?: number | null;
}

const novelDownloadChapterSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  name: z.string().trim().max(300).optional(),
  index: z.number().int().nullable().optional()
});

const novelDownloadJobs = new Map<string, NovelDownloadJobDto>();
const canceledNovelDownloads = new Set<string>();
const NOVEL_DOWNLOAD_JOB_LIMIT = 20;

function jobChapterLabel(chapter: NovelDownloadChapterInput): string {
  return (
    chapter.name ||
    (chapter.index !== null && chapter.index !== undefined
      ? `Capítulo ${chapter.index}`
      : chapter.url)
  );
}

async function processNovelDownloadJob(job: NovelDownloadJobDto): Promise<void> {
  const queue = job.chapters.filter((chapter) => chapter.status === 'pending');
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < queue.length) {
      if (canceledNovelDownloads.has(job.id)) break;
      const chapter = queue[index++];
      if (chapter.status !== 'pending') continue;
      chapter.status = 'downloading';
      chapter.error = null;
      job.current = chapter.name;
      try {
        const url = new URL(chapter.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('use http:// ou https://');
        }
        const urlKey = url.toString();
        const cacheKey = novelChapterCacheKey(urlKey);
        const cached = getNovelCache<NovelChapterContentDto>(cacheKey);
        const challenge = cached
          ? isNovelChallengePage(cached.data.title, cached.data.text)
          : false;
        const wrongChapter = cached ? !isSameChapter(cached.data.url, urlKey) : false;
        const usable = cached && !challenge && !wrongChapter ? cached.data : null;
        const translated =
          !job.language || usable?.translatedLanguage === job.language;

        if (usable && translated) {
          chapter.status = 'done';
          job.completed++;
          continue;
        }

        const content = usable ?? (await loadNovelChapter(urlKey, true, () => canceledNovelDownloads.has(job.id)));
        if ((chapter.status as string) === 'canceled') continue;
        if (job.language && content.text) {
          const result = await translateTextTo(content.text, job.language);
          updateNovelChapterCache(
            cacheKey,
            {
              translatedText: result.text,
              translatedLanguage: job.language
            },
            NOVEL_CHAPTER_FRESH_MS
          );
        }
        chapter.status = 'done';
        job.completed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ((chapter.status as string) === 'canceled') continue;
        chapter.status = 'failed';
        chapter.error = message;
        job.failed++;
        job.errors.push(`${chapter.name}: ${message}`);
      }
      // Um capítulo por vez, com uma pausa para não sobrecarregar o site.
      if (!canceledNovelDownloads.has(job.id)) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  };

  await worker();
  const canceled = canceledNovelDownloads.has(job.id);
  job.status = canceled ? 'canceled' : 'done';
  job.current = null;
  job.finishedAt = nowIso();
}

function startNovelDownloadJob(
  title: string,
  chapters: NovelDownloadChapterInput[],
  language: string
): NovelDownloadJobDto {
  const id = randomUUID();
  const seen = new Set<string>();
  const unique = chapters.filter((chapter) => {
    const key = chapter.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const job: NovelDownloadJobDto = {
    id,
    title,
    status: 'running',
    language,
    total: unique.length,
    completed: 0,
    failed: 0,
    current: null,
    chapters: unique.map((chapter) => ({
      url: chapter.url.trim(),
      name: jobChapterLabel(chapter),
      index: chapter.index ?? null,
      status: 'pending',
      error: null
    })),
    errors: [],
    startedAt: nowIso(),
    finishedAt: null
  };
  novelDownloadJobs.set(id, job);
  while (novelDownloadJobs.size > NOVEL_DOWNLOAD_JOB_LIMIT) {
    const oldest = novelDownloadJobs.keys().next().value;
    if (!oldest) break;
    novelDownloadJobs.delete(oldest);
  }

  void processNovelDownloadJob(job).catch((error) => {
    job.errors.push(error instanceof Error ? error.message : String(error));
    job.status = canceledNovelDownloads.has(job.id) ? 'canceled' : 'done';
    job.current = null;
    job.finishedAt = nowIso();
  });

  return job;
}

sourcesRouter.post('/novels/download', (req, res) => {
  const body = parseBody(
    z.object({
      title: z.string().trim().max(200).optional(),
      chapters: z.array(novelDownloadChapterSchema).min(1).max(1000)
    }),
    req.body
  );
  const settings = getSettings();
  const language = TRANSLATE_ALLOWED_TARGETS.has(settings.language)
    ? settings.language
    : 'pt';
  const job = startNovelDownloadJob(
    body.title?.trim() || 'Novel',
    body.chapters,
    language
  );
  res.status(202).json(job);
});

sourcesRouter.post('/novels/download/status', (req, res) => {
  const body = parseBody(
    z.object({
      chapters: z.array(novelDownloadChapterSchema).min(1).max(5000)
    }),
    req.body
  );
  const settings = getSettings();
  const language = TRANSLATE_ALLOWED_TARGETS.has(settings.language)
    ? settings.language
    : 'pt';

  const chapters = body.chapters.map((chapter) => {
    try {
      const url = new URL(chapter.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { url: chapter.url, downloaded: false, translated: false };
      }
      const cached = getNovelCache<NovelChapterContentDto>(
        novelChapterCacheKey(url.toString())
      );
      const challenge = cached
        ? isNovelChallengePage(cached.data.title, cached.data.text)
        : false;
      const downloaded = Boolean(cached && !challenge);
      return {
        url: chapter.url,
        downloaded,
        translated:
          downloaded && cached?.data.translatedLanguage === language
      };
    } catch {
      return { url: chapter.url, downloaded: false, translated: false };
    }
  });

  res.json({ chapters });
});

sourcesRouter.post('/novels/download/:id/retry', (req, res) => {
  const job = novelDownloadJobs.get(req.params.id);
  if (!job) throw new HttpError(404, 'Download não encontrado.', 'not_found');
  if (job.status === 'running') {
    res.status(202).json(job);
    return;
  }

  const failed = job.chapters.filter((chapter) => chapter.status === 'failed');
  if (failed.length === 0) {
    res.json(job);
    return;
  }

  for (const chapter of failed) {
    chapter.status = 'pending';
    chapter.error = null;
  }
  job.failed = 0;
  job.errors = [];
  job.status = 'running';
  job.finishedAt = null;
  canceledNovelDownloads.delete(job.id);
  void processNovelDownloadJob(job).catch((error) => {
    job.errors.push(error instanceof Error ? error.message : String(error));
    job.status = canceledNovelDownloads.has(job.id) ? 'canceled' : 'done';
    job.current = null;
    job.finishedAt = nowIso();
  });
  res.status(202).json(job);
});

sourcesRouter.post('/novels/download/:id/cancel', (req, res) => {
  const job = novelDownloadJobs.get(req.params.id);
  if (!job) throw new HttpError(404, 'Download não encontrado.', 'not_found');
  if (job.status !== 'running') {
    res.json(job);
    return;
  }

  canceledNovelDownloads.add(job.id);
  for (const chapter of job.chapters) {
    if (chapter.status === 'pending' || chapter.status === 'downloading') {
      chapter.status = 'canceled';
      chapter.error = null;
    }
  }
  job.status = 'canceled';
  job.current = null;
  job.finishedAt = nowIso();
  res.json(job);
});

sourcesRouter.get('/novels/download/:id', (req, res) => {
  const job = novelDownloadJobs.get(req.params.id);
  if (!job) throw new HttpError(404, 'Download não encontrado.', 'not_found');
  res.json(job);
});

interface ArticleCacheEntry {
  data: ArticleContentDto;
  expiresAt: number;
}

const ARTICLE_CACHE_TTL_MS = 30 * 60_000;
const ARTICLE_CACHE_MAX = 30;
const articleCache = new Map<string, ArticleCacheEntry>();

const ARTICLE_CONTENT_EXTRACT = `(() => {
  const textOf = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const selectors = [
    '[itemprop="articleBody"]',
    '.article-body',
    '.article__body',
    '.article-content',
    '.article__content',
    '.content-text',
    '.post-content',
    '.entry-content',
    '.materia-conteudo',
    '.c-content',
    'article',
    'main'
  ];
  let best = null;
  let bestLength = 300;
  for (const selector of selectors) {
    for (const candidate of document.querySelectorAll(selector)) {
      const length = textOf(candidate).length;
      if (length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    }
  }
  if (!best) best = document.body;
  const clone = best.cloneNode(true);
  clone
    .querySelectorAll(
      'script, style, noscript, nav, aside, footer, header, form, iframe, svg, button, .ad, .ads, .advertisement, [class*="banner"], [class*="publicidade"], [class*="related"], [class*="share"], [class*="comment"], [class*="newsletter"], [class*="paywall"], [id*="publicidade"]'
    )
    .forEach((element) => element.remove());
  const titleEl =
    document.querySelector('h1') || document.querySelector('[itemprop="headline"]');
  const metaTitle = document.querySelector('meta[property="og:title"]');
  const site = document.querySelector('meta[property="og:site_name"]');
  const title =
    textOf(titleEl) ||
    (metaTitle && metaTitle.getAttribute('content')) ||
    document.title;

  // innerText em um nó solto não calcula layout (vira textContent). Mantemos o
  // clone no documento, fora da tela, para preservar parágrafos e quebras.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:720px;';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  const rawText = (clone.innerText || holder.innerText || '').replace(/\\r/g, '');
  holder.remove();

  const text = rawText
    .split('\\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^(publicidade|continua após a publicidade|advertisement|leia também|compartilhe|share this article|atualizada? em|publicado em)$/i.test(
          line
        )
    )
    .filter((line) => line !== title)
    .filter(
      (line) =>
        !/^(?:atualizada?\\s*em\\s*)?\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}(?:\\s+\\d{1,2}h\\d{2})?$/i.test(
          line
        )
    )
    .join('\\n\\n')
    .slice(0, 300000);

  return {
    title,
    siteName:
      (site && site.getAttribute('content')) ||
      location.hostname.replace(/^www\\./i, ''),
    text
  };
})()`;

sourcesRouter.get('/articles/content', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!raw) throw new HttpError(400, 'Informe a URL da notícia.', 'validation');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, 'URL de notícia inválida.', 'validation');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, 'Use um endereço http:// ou https://.', 'validation');
  }

  const cacheKey = target.toString();
  const cached = articleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.data);
    return;
  }

  try {
    const result = await renderPageJson<{
      title: string;
      siteName: string;
      text: string;
    }>({
      url: cacheKey,
      readyExpression:
        'document.body && document.body.innerText.trim().length > 180',
      expression: ARTICLE_CONTENT_EXTRACT,
      timeoutMs: 45_000
    });
    const text = result.data?.text?.trim() ?? '';
    if (text.length < 120) {
      throw new Error('O conteúdo da notícia não foi encontrado nesta página.');
    }

    const data: ArticleContentDto = {
      url: result.finalUrl || cacheKey,
      title: result.data?.title?.trim() || result.title || 'Notícia',
      siteName:
        result.data?.siteName?.trim() ||
        target.hostname.replace(/^www\./i, ''),
      text,
      fetchedAt: nowIso()
    };

    if (articleCache.size >= ARTICLE_CACHE_MAX) {
      const oldest = articleCache.keys().next().value;
      if (oldest) articleCache.delete(oldest);
    }
    articleCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + ARTICLE_CACHE_TTL_MS
    });
    res.json(data);
  } catch (error) {
    throw new HttpError(
      502,
      `Não foi possível carregar a notícia. ${error instanceof Error ? error.message : String(error)}`,
      'article_content'
    );
  }
});

sourcesRouter.put('/sources/:id/novel-progress', (req, res) => {  const body = parseBody(novelProgressSchema, req.body);
  const row = getSourceRow(req.params.id);
  if (!row) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  if (row.type !== 'webnovel') {
    throw new HttpError(400, 'Esta fonte não é uma novel da Webnovel.', 'not_supported');
  }

  const config = parseJson<Record<string, unknown>>(row.config, {});
  const progress: NovelProgressDto = {
    chapterId: body.chapterId,
    chapterIndex: body.chapterIndex ?? null,
    chapterName: body.chapterName,
    updatedAt: nowIso()
  };
  const updated = updateSource(row.id, {
    config: { ...config, lastReadChapter: progress }
  });
  res.json(updated);
});

sourcesRouter.delete('/sources/:id/novel-progress', (req, res) => {
  const row = getSourceRow(req.params.id);
  if (!row) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  if (row.type !== 'webnovel') {
    throw new HttpError(400, 'Esta fonte não é uma novel da Webnovel.', 'not_supported');
  }

  const config = parseJson<Record<string, unknown>>(row.config, {});
  const next = { ...config };
  delete next.lastReadChapter;
  const updated = updateSource(row.id, { config: next });
  res.json(updated);
});

sourcesRouter.post('/sources/resolve', async (req, res) => {
  const body = parseBody(resolveSourceSchema, req.body);
  const connector = requireConnector(body.type);
  if (!connector.resolve) {
    throw new HttpError(400, 'Este tipo de fonte não aceita URL para resolver.', 'not_supported');
  }
  const resolved = await connector.resolve(body.input, getSettings());
  res.json(resolved);
});

sourcesRouter.get('/sources/:id/runs', (req, res) => {
  const source = getSource(req.params.id);
  if (!source) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  res.json({ runs: listRuns(req.params.id, 10) });
});

sourcesRouter.post('/sources/:id/refresh', (req, res) => {
  const source = getSource(req.params.id);
  if (!source) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  const queued = enqueueSource(source.id, true);
  res.status(202).json({ queued });
});

sourcesRouter.post('/sources', async (req, res) => {
  const body = parseBody(createSourceSchema, req.body);
  const connector = requireConnector(body.type);
  if (!connector.resolve) {
    throw new HttpError(400, 'Este tipo de fonte não aceita URL para resolver.', 'not_supported');
  }
  if (!getCategory(body.categoryId)) {
    throw new HttpError(400, 'Categoria inexistente.', 'validation');
  }

  const settings = getSettings();
  const resolved = await connector.resolve(body.input, settings);
  assertMediaAvailable(resolved.config);
  const config =
    body.imdbId !== undefined
      ? { ...resolved.config, imdbIdOverride: body.imdbId.trim() ? body.imdbId.trim() : null }
      : resolved.config;

  const intervalMinutes = Math.max(
    body.intervalMinutes ?? Math.max(settings.defaultIntervalMinutes, connector.defaultIntervalMinutes),
    connector.minIntervalMinutes
  );

  const source = createSource({
    type: body.type as SourceType,
    name: body.name?.trim() || resolved.name,
    categoryId: body.categoryId,
    config,
    intervalMinutes
  });

  // A wishlist da Steam vem acompanhada do monitor de preços.
  if (source.type === 'steam-wishlist') ensureGgdealsSource();

  enqueueSource(source.id, true);
  res.status(201).json(source);
});

sourcesRouter.patch('/sources/:id', async (req, res) => {
  const body = parseBody(updateSourceSchema, req.body);
  const row = getSourceRow(req.params.id);
  if (!row) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');

  if (body.categoryId && !getCategory(body.categoryId)) {
    throw new HttpError(400, 'Categoria inexistente.', 'validation');
  }

  const connector = requireConnector(row.type);
  let config = parseJson<Record<string, unknown>>(row.config, {});
  let name = body.name ?? row.name;
  let reResolved = false;

  if (body.input && connector.resolve) {
    const resolved = await connector.resolve(body.input, getSettings());
    assertMediaAvailable(resolved.config, row.id);
    config = resolved.config;
    name = body.name?.trim() || resolved.name;
    reResolved = true;
  }

  const imdbChanged = body.imdbId !== undefined;
  if (imdbChanged) {
    config = {
      ...config,
      imdbIdOverride: body.imdbId && body.imdbId.trim() ? body.imdbId.trim() : null
    };
  }

  const intervalMinutes = body.intervalMinutes
    ? Math.max(body.intervalMinutes, connector.minIntervalMinutes)
    : undefined;

  const updated = updateSource(row.id, {
    name,
    categoryId: body.categoryId,
    intervalMinutes,
    enabled: body.enabled,
    config: reResolved || imdbChanged ? config : undefined
  });

  if (reResolved || imdbChanged) enqueueSource(row.id, true);
  res.json(updated);
});

sourcesRouter.post('/sources/bulk-delete', (req, res) => {
  const body = parseBody(
    z.object({ ids: z.array(z.string().trim().min(1)).min(1).max(500) }),
    req.body
  );
  for (const id of body.ids) {
    const row = getSourceRow(id);
    if (row) purgeNovelSource(row);
  }
  const deleted = deleteSources(body.ids);
  res.json({ deleted });
});

sourcesRouter.delete('/sources/:id', (req, res) => {
  const row = getSourceRow(req.params.id);
  if (!row) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  purgeNovelSource(row);
  const removed = deleteSource(req.params.id);
  if (!removed) throw new HttpError(404, 'Fonte não encontrada.', 'not_found');
  res.status(204).end();
});

