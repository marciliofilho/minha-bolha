/** Item sintético para uma novel que ainda não tem itens sincronizados. */
import type { FeedItemDto, SourceDto } from '@hub/shared';

export function syntheticNovelItem(source: SourceDto): FeedItemDto | null {
  const config = source.config ?? {};
  const latest = config.latestChapter as
    | { id?: string; name?: string; index?: number | null; url?: string }
    | null
    | undefined;
  if (!latest?.url) return null;
  const title =
    typeof config.title === 'string' && config.title.trim()
      ? config.title.trim()
      : source.name;
  const coverUrl = typeof config.coverUrl === 'string' ? config.coverUrl : null;
  return {
    id: `novel-source:${source.id}`,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    categoryId: 'novel',
    categoryLabel: 'Novels',
    kind: 'chapter',
    title: latest.name || title,
    url: latest.url,
    thumbnailUrl: coverUrl,
    description: null,
    author: null,
    publishedAt: source.lastSuccessAt ?? source.createdAt,
    isRead: true,
    isFavorite: false,
    isWatchLater: false,
    meta: {
      bookId: config.bookId ?? null,
      bookTitle: title,
      chapterId: latest.id ?? null,
      chapterName: latest.name ?? null,
      chapterIndex: latest.index ?? null,
      chapterCount: typeof config.chapterCount === 'number' ? config.chapterCount : null,
      coverUrl
    },
    imdbId: null,
    mediaKind: null,
    inStremioLibrary: false
  };
}
