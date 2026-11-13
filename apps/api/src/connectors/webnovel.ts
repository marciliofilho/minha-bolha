/**
 * Conector da Webnovel.
 *
 * A página da novel é protegida por Cloudflare e não responde a fetch comum.
 * Lemos a página em um navegador headless local e extraímos o objeto `g_data.book`,
 * que traz capa, capítulos e o horário exato de publicação.
 */
import { ConnectorError } from './types';
import type { NovelChapter, NovelSnapshot } from './novel-types';
import { liveRenderJson, MOBILE_USER_AGENT, toMobileUrl } from '../lib/live-browser';
import { renderPageJson } from '../lib/headless-browser';
import { desktopExtractAvailable, extractViaDesktop } from '../lib/desktop-extract';
import { isNovelUnavailablePage } from '../lib/webnovel-url';

interface RawChapter {
  id?: string;
  index?: number | null;
  name?: string;
  publishedAt?: string | null;
  isVip?: boolean;
}

interface RawNovel {
  bookId?: string;
  title?: string;
  author?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  chapterCount?: number;
  coverUpdateTime?: number;
  locale?: string | null;
  latest?: RawChapter | null;
  chapters?: RawChapter[];
}

const NOVEL_HOSTS = new Set(['webnovel.com', 'www.webnovel.com', 'm.webnovel.com']);
const READY_EXPRESSION =
  'window.g_data && window.g_data.book && window.g_data.book.bookInfo && window.g_data.book.bookInfo.bookId';

const EXTRACT_EXPRESSION = `(() => {
  const book = window.g_data && window.g_data.book;
  if (!book || !book.bookInfo) return null;
  const info = book.bookInfo;
  const chapters = [];
  for (const volume of book.volumeItems || []) {
    for (const chapter of volume.chapterItems || []) {
      chapters.push({
        id: chapter.chapterId ? String(chapter.chapterId) : '',
        index: typeof chapter.chapterIndex === 'number' ? chapter.chapterIndex : null,
        name: chapter.chapterName ? String(chapter.chapterName) : '',
        publishedAt: chapter.publishTime ? new Date(chapter.publishTime).toISOString() : null,
        isVip: chapter.isVip === 1
      });
    }
  }
  const last = book.lastChapterItem || null;
  return {
    bookId: info.bookId ? String(info.bookId) : '',
    title: info.bookName ? String(info.bookName) : '',
    author: info.authorName ? String(info.authorName) : null,
    description: info.description ? String(info.description) : null,
    category: info.categoryName ? String(info.categoryName) : null,
    tags: (info.tagInfos || []).map((tag) => String(tag.tagName || '')).filter(Boolean),
    chapterCount: Number(info.chapterNum || chapters.length || 0),
    coverUpdateTime: Number(info.coverUpdateTime || 0),
    locale: info.languageName ? String(info.languageName) : null,
    latest: last ? {
      id: last.chapterId ? String(last.chapterId) : '',
      index: typeof last.chapterIndex === 'number' ? last.chapterIndex : null,
      name: last.chapterName ? String(last.chapterName) : '',
      publishedAt: last.publishTime ? new Date(last.publishTime).toISOString() : null,
      isVip: last.isVip === 1
    } : null,
    chapters
  };
})()`;

interface NovelUrlInfo {
  bookId: string;
  locale: string | null;
  url: string;
}

function parseNovelUrl(raw: string): NovelUrlInfo {
  const value = raw.trim();
  if (!value) throw new ConnectorError('config', 'Informe a página da novel.');

  let url: URL;
  try {
    if (/^https?:\/\//i.test(value)) {
      url = new URL(value);
    } else if (/^(www\.)?webnovel\.com\//i.test(value)) {
      url = new URL(`https://${value}`);
    } else {
      throw new Error('sem host');
    }
  } catch {
    throw new ConnectorError('config', 'Cole a URL completa da novel na Webnovel.');
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (!NOVEL_HOSTS.has(host) && !NOVEL_HOSTS.has(`www.${host}`)) {
    throw new ConnectorError('config', 'A URL precisa ser de uma página da Webnovel (webnovel.com).');
  }

  const match =
    /\/book\/(\d{6,})(?:[/?#]|$)/i.exec(url.pathname) ??
    /\/book\/[^/?#]*?_(\d{6,})(?:[/?#]|$)/i.exec(url.pathname) ??
    /\/book\/[^/?#]*?(\d{6,})(?:[/?#]|$)/i.exec(url.pathname);
  if (!match?.[1]) {
    throw new ConnectorError('config', 'Não encontrei o ID da novel na URL. Use a página do livro.');
  }
  const bookId = match[1];
  const localeMatch = /^\/([a-z]{2}(?:-[a-z]{2})?)\/book\//i.exec(url.pathname);
  const locale = localeMatch?.[1]?.toLowerCase() ?? 'pt';
  const base = `https://www.webnovel.com/${locale}`;

  return { bookId, locale, url: `${base}/book/${bookId}` };
}

function coverUrlFor(bookId: string, coverUpdateTime: number | undefined): string {
  const suffix = coverUpdateTime ? `&imageId=${coverUpdateTime}` : '';
  return `https://book-pic.webnovel.com/bookcover/${bookId}?imageMogr2/thumbnail/600x${suffix}`;
}

function chapterUrl(info: NovelUrlInfo, chapterId: string): string {
  return `https://www.webnovel.com/${info.locale ?? 'pt'}/book/${info.bookId}/${chapterId}`;
}

function toChapter(raw: RawChapter, info: NovelUrlInfo): NovelChapter | null {
  if (!raw?.id || !raw.name) return null;
  return {
    id: raw.id,
    index: typeof raw.index === 'number' ? raw.index : null,
    name: raw.name,
    publishedAt: raw.publishedAt ?? null,
    isVip: raw.isVip === true,
    url: chapterUrl(info, raw.id)
  };
}

/** Detecta se a URL pertence à Webnovel (que tem um extrator dedicado). */
export function isWebnovelInput(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'webnovel.com' || host.endsWith('.webnovel.com');
  } catch {
    return false;
  }
}

export async function loadWebnovelPage(input: string): Promise<NovelSnapshot> {
  const parsed = parseNovelUrl(input);

  const baseOptions = {
    url: parsed.url,
    readyExpression: READY_EXPRESSION,
    expression: EXTRACT_EXPRESSION
  };
  const feedPort = await desktopExtractAvailable();
  const attempts: Array<{
    label: string;
    run: () => Promise<{ data: RawNovel | null; title: string; finalUrl: string }>;
  }> = [
    ...(feedPort
      ? [
          {
            label: 'feed',
            run: () =>
              extractViaDesktop<RawNovel>({ ...baseOptions, timeoutMs: 20_000 })
          }
        ]
      : []),
    {
      label: 'live',
      run: () => liveRenderJson<RawNovel>({ ...baseOptions, timeoutMs: 15_000 })
    },
    {
      label: 'live-móvel',
      run: () =>
        liveRenderJson<RawNovel>({
          ...baseOptions,
          timeoutMs: 12_000,
          mobile: true
        })
    },
    {
      label: 'scraping',
      run: () =>
        renderPageJson<RawNovel>({ ...baseOptions, timeoutMs: 12_000 })
    },
    {
      label: 'scraping-móvel',
      run: () =>
        renderPageJson<RawNovel>({
          ...baseOptions,
          url: toMobileUrl(parsed.url),
          timeoutMs: 10_000,
          userAgent: MOBILE_USER_AGENT
        })
    }
  ];

  let data: RawNovel | null = null;
  let notFound = false;
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      const candidate = result.data;
      if (isNovelUnavailablePage(result.title, '')) {
        notFound = true;
        throw new ConnectorError(
          'not_found',
          'A página da Webnovel retornou 404. O livro pode ter sido removido ou estar indisponível.'
        );
      }
      if (!candidate?.bookId || !candidate.title) {
        throw new Error('dados da novel não encontrados');
      }
      if (candidate.bookId !== parsed.bookId) {
        throw new Error('a página retornou outra novel');
      }
      data = candidate;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${attempt.label}: ${message}`);
      console.warn(`[webnovel] ${parsed.url} — ${attempt.label}: ${message}`);
    }
  }

  if (!data) {
    if (notFound) {
      throw new ConnectorError(
        'not_found',
        'A página da Webnovel retornou 404. O livro pode ter sido removido ou estar indisponível.'
      );
    }
    throw new ConnectorError(
      'blocked',
      `A Webnovel não liberou a página. ${failures.join(' | ')}`
    );
  }

  const chapters = (data.chapters ?? [])
    .map((chapter) => toChapter(chapter, parsed))
    .filter((chapter): chapter is NovelChapter => chapter !== null)
    .filter((chapter, index, all) => all.findIndex((item) => item.id === chapter.id) === index)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const latestRaw = data.latest?.id && data.latest.name ? data.latest : null;
  const latestChapter = latestRaw ? toChapter(latestRaw, parsed) : (chapters[chapters.length - 1] ?? null);

  return {
    provider: 'webnovel',
    bookId: data.bookId as string,
    title: data.title as string,
    author: data.author?.trim() ? data.author.trim() : null,
    description: data.description?.trim() ? data.description.trim() : null,
    category: data.category?.trim() ? data.category.trim() : null,
    tags: (data.tags ?? []).filter(Boolean),
    chapterCount: data.chapterCount ?? chapters.length,
    coverUrl: coverUrlFor(parsed.bookId, data.coverUpdateTime),
    locale: parsed.locale,
    bookUrl: parsed.url,
    siteName: 'webnovel.com',
    latestChapter,
    chapters
  };
}


