/** Tipos internos compartilhados pelos adaptadores de novel. */

export type NovelProvider = 'webnovel' | 'generic';

export interface NovelChapter {
  /** Identificador estável usado no banco e no progresso (ID numérico ou hash da URL). */
  id: string;
  index: number | null;
  name: string;
  /** ISO UTC; nulo quando o site não publica a data do capítulo. */
  publishedAt: string | null;
  isVip: boolean;
  /** URL absoluta do capítulo. */
  url: string | null;
}

export interface NovelSnapshot {
  provider: NovelProvider;
  bookId: string;
  title: string;
  author: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  chapterCount: number;
  coverUrl: string | null;
  locale: string | null;
  bookUrl: string;
  siteName: string | null;
  latestChapter: NovelChapter | null;
  chapters: NovelChapter[];
}
