/**
 * Conector de novels.
 *
 * Webnovel tem um extrator dedicado; os demais sites usam o extrator genérico.
 * O tipo interno continua "webnovel" para preservar as fontes já cadastradas,
 * mas a interface aceita qualquer página de novel.
 */
import type {
  NovelBookDto,
  NovelChapterDto,
  ResolvedSourceDto,
  SettingsDto
} from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawItem } from './types';
import { ConnectorError } from './types';
import type { NovelChapter, NovelSnapshot } from './novel-types';
import { isWebnovelInput, loadWebnovelPage } from './webnovel';
import { loadGenericNovelPage } from './novel-generic';
import { nowIso } from '../lib/dates';
import { truncate } from './util';
import {
  novelDetailsCacheKey,
  setNovelCache
} from '../db/repositories/novel-cache';

export type { NovelSnapshot } from './novel-types';
export { isWebnovelInput } from './webnovel';

/** Quanto tempo uma lista de capítulos é considerada fresca (prévia). */
export const NOVEL_DETAILS_FRESH_MS = 5 * 60_000;
/** Quanto tempo o conteúdo de um capítulo é considerado fresco. */
export const NOVEL_CHAPTER_FRESH_MS = 30 * 60_000;

export async function loadNovelSite(input: string): Promise<NovelSnapshot> {
  return isWebnovelInput(input) ? loadWebnovelPage(input) : loadGenericNovelPage(input);
}

export function novelToDto(snapshot: NovelSnapshot): NovelBookDto {
  return {
    bookId: snapshot.bookId,
    title: snapshot.title,
    author: snapshot.author,
    coverUrl: snapshot.coverUrl,
    description: snapshot.description,
    category: snapshot.category,
    tags: snapshot.tags,
    chapterCount: snapshot.chapterCount,
    latestChapter: snapshot.latestChapter
      ? {
          id: snapshot.latestChapter.id,
          index: snapshot.latestChapter.index,
          name: snapshot.latestChapter.name,
          publishedAt: snapshot.latestChapter.publishedAt,
          isVip: snapshot.latestChapter.isVip,
          url: snapshot.latestChapter.url
        }
      : null,
    url: snapshot.bookUrl
  };
}

/** Dados cacheados da prévia: livro + lista completa de capítulos. */
export function novelDetailsFromSnapshot(snapshot: NovelSnapshot): {
  book: NovelBookDto;
  chapters: NovelChapterDto[];
} {
  return {
    book: novelToDto(snapshot),
    chapters: snapshot.chapters.map((chapter) => ({
      id: chapter.id,
      index: chapter.index,
      name: chapter.name,
      publishedAt: chapter.publishedAt,
      isVip: chapter.isVip,
      url: chapter.url
    }))
  };
}

function chapterTitle(chapter: NovelChapter): string {
  const number = chapter.index !== null ? `Cap. ${chapter.index}` : null;
  const name = chapter.name.trim();
  if (!name) return number ?? 'Novo capítulo';
  // Evita "Cap. 12: Capítulo 12" quando o site já usa o número no título.
  if (number && !/^(?:cap\.?|cap[ií]tulo|chapter|ch\.?)\s*\d/i.test(name)) {
    return `${number}: ${name}`;
  }
  return name;
}

function chapterHref(snapshot: NovelSnapshot, chapter: NovelChapter): string {
  return chapter.url ?? snapshot.bookUrl;
}

function buildItem(snapshot: NovelSnapshot, chapter: NovelChapter): RawItem {
  return {
    externalId: `${snapshot.bookId}:${chapter.id}`,
    dedupeKey: `${snapshot.provider}:${snapshot.bookId}:${chapter.id}`,
    kind: 'chapter',
    title: chapterTitle(chapter),
    url: chapterHref(snapshot, chapter),
    thumbnailUrl: snapshot.coverUrl,
    description: [
      chapter.index !== null ? `Capítulo ${chapter.index} de ${snapshot.chapterCount}` : null,
      snapshot.author,
      snapshot.tags.slice(0, 3).join(' · ')
    ]
      .filter(Boolean)
      .join(' · '),
    author: snapshot.author,
    publishedAt: chapter.publishedAt ?? nowIso(),
    meta: {
      provider: snapshot.provider,
      siteName: snapshot.siteName,
      bookId: snapshot.bookId,
      bookTitle: snapshot.title,
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      chapterName: chapter.name,
      chapterCount: snapshot.chapterCount,
      coverUrl: snapshot.coverUrl,
      category: snapshot.category,
      tags: snapshot.tags.slice(0, 8),
      bookUrl: snapshot.bookUrl
    }
  };
}

export async function resolveNovel(input: string, _settings: SettingsDto): Promise<ResolvedSourceDto> {
  const snapshot = await loadNovelSite(input);
  const recent = [...snapshot.chapters].reverse().slice(0, 3);
  const sampleChapters = recent.length > 0 ? recent : snapshot.latestChapter ? [snapshot.latestChapter] : [];

  return {
    name: snapshot.title,
    categoryId: 'novel',
    config: {
      provider: snapshot.provider,
      site: snapshot.siteName,
      bookId: snapshot.bookId,
      url: snapshot.bookUrl,
      locale: snapshot.locale,
      title: snapshot.title,
      author: snapshot.author,
      coverUrl: snapshot.coverUrl,
      description: truncate(snapshot.description ?? '', 900) || null,
      category: snapshot.category,
      tags: snapshot.tags,
      chapterCount: snapshot.chapterCount,
      latestChapter: snapshot.latestChapter
    },
    samples: sampleChapters.map((chapter) => ({
      title: chapterTitle(chapter),
      url: chapterHref(snapshot, chapter),
      publishedAt: chapter.publishedAt
    }))
  };
}

interface NovelState {
  lastPublishedAt?: string | null;
  lastChapterId?: string | null;
}

export const novelsConnector: Connector = {
  type: 'webnovel',
  defaultIntervalMinutes: 60,
  minIntervalMinutes: 30,

  resolve: resolveNovel,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<NovelState>> {
    const configuredUrl =
      typeof ctx.config.url === 'string'
        ? ctx.config.url
        : ctx.config.provider !== 'generic' && typeof ctx.config.bookId === 'string'
          ? `https://www.webnovel.com/${String(ctx.config.locale ?? 'pt')}/book/${ctx.config.bookId}`
          : '';
    if (!configuredUrl) {
      throw new ConnectorError('config', 'Fonte de novel sem URL ou ID do livro.');
    }

    const snapshot = await loadNovelSite(configuredUrl);
    setNovelCache(
      novelDetailsCacheKey(ctx.source.id, configuredUrl),
      'details',
      novelDetailsFromSnapshot(snapshot),
      NOVEL_DETAILS_FRESH_MS
    );
    const state = (ctx.state ?? {}) as NovelState;
    const all =
      snapshot.chapters.length > 0
        ? snapshot.chapters
        : snapshot.latestChapter
          ? [snapshot.latestChapter]
          : [];

    let selected: NovelChapter[] = [];
    const lastId = state.lastChapterId ?? null;
    if (!lastId && !state.lastPublishedAt) {
      // Primeira sincronização: só o capítulo mais recente.
      selected = all.slice(-1);
    } else if (lastId) {
      const lastIndex = all.findIndex((chapter) => chapter.id === lastId);
      if (lastIndex >= 0) {
        selected = all.slice(lastIndex + 1);
      } else if (state.lastPublishedAt) {
        selected = all.filter(
          (chapter) => chapter.publishedAt !== null && chapter.publishedAt > state.lastPublishedAt!
        );
      }
      if (selected.length === 0 && snapshot.latestChapter && snapshot.latestChapter.id !== lastId) {
        selected = [snapshot.latestChapter];
      }
    }

    const items = selected.map((chapter) => buildItem(snapshot, chapter));
    const newest = snapshot.latestChapter ?? all[all.length - 1] ?? null;
    const newestDated = all.reduce<string | null>((latest, chapter) => {
      if (!chapter.publishedAt) return latest;
      if (!latest || chapter.publishedAt > latest) return chapter.publishedAt;
      return latest;
    }, state.lastPublishedAt ?? null);

    ctx.logger.debug(
      `${snapshot.siteName ?? snapshot.provider} ${snapshot.title}: ${all.length} capítulo(s), ${items.length} novo(s)`
    );

    return {
      items,
      state: {
        lastPublishedAt: newestDated,
        lastChapterId: newest?.id ?? state.lastChapterId ?? null
      }
    };
  }
};
