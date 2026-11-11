/** Rotinas da biblioteca Stremio: sincronização (somente leitura) e importação. */
import type { StremioImportResultDto, StremioLibraryItemDto } from '@hub/shared';
import {
  deleteStremioLibraryState,
  getStremioLibraryRow,
  getStremioLibraryState,
  listStremioLibraryRows,
  listStremioLibraryStates,
  searchStremioLibraryRows,
  setStremioLibraryState,
  syncStremioLibraryRows,
  updateStremioLastSync,
  type StremioLibraryStatePatch
} from '../db/repositories/stremio';
import type { StremioLibraryRow, StremioLibraryStateRow } from '../db/types';
import { createSource, findSourceByImdb } from '../db/repositories/sources';
import { findMediaByExternal, findMediaByImdb } from '../db/repositories/media';
import { getSettings } from '../db/repositories/settings';
import { tmdbConnector } from '../connectors/tmdb';
import { anilistConnector } from '../connectors/anilist';
import { hasSecret } from '../lib/secrets';
import { nowIso } from '../lib/dates';
import type { RawStremioLibraryItem } from '../connectors/types';

export function syncStremioLibrary(items: RawStremioLibraryItem[]): { saved: number } {
  const result = syncStremioLibraryRows(items);
  updateStremioLastSync(nowIso());
  return result;
}

function isAnimeId(metaId: string): boolean {
  return /^(kitsu|anilist|mal|myanimelist|anidb):/i.test(metaId);
}

/** Animações do TMDB (gênero Animation) entram em Animação/Anime. */
function mediaIsAnimation(imdbId: string | null): boolean {
  if (!imdbId) return false;
  const media = findMediaByImdb(imdbId);
  if (!media?.raw) return false;
  try {
    const raw = JSON.parse(media.raw) as {
      genres?: Array<{ name?: string | null }>;
    };
    return (raw.genres ?? []).some((genre) => /anima[cç]/i.test(genre.name ?? ''));
  } catch {
    return false;
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sortLibraryItems(a: StremioLibraryItemDto, b: StremioLibraryItemDto): number {
  return (
    (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
    a.name.localeCompare(b.name, 'pt-BR')
  );
}

function toLibraryItem(
  row: StremioLibraryRow,
  state?: StremioLibraryStateRow
): StremioLibraryItemDto {
  const progress =
    row.duration && row.duration > 0 && row.time_offset
      ? Math.min(1, Math.max(0, row.time_offset / row.duration))
      : 0;
  return {
    metaId: row.meta_id,
    imdbId: row.imdb_id,
    videoId: row.video_id,
    type: row.type === 'series' ? 'series' : 'movie',
    name: row.name,
    poster: row.poster,
    season: row.season,
    episode: row.episode,
    progress,
    timeOffsetMs: row.time_offset,
    durationMs: row.duration,
    watchedVideoId: row.watched_video_id,
    lastWatchedAt: row.last_watched_at,
    isFavorite: state?.is_favorite === 1,
    isWatchLater: state?.is_watch_later === 1,
    inLibrary: true,
    isLocal: false,
    isAnime: isAnimeId(row.meta_id) || mediaIsAnimation(row.imdb_id)
  };
}

function toLocalItem(state: StremioLibraryStateRow): StremioLibraryItemDto {
  const type = state.meta_type === 'series' ? 'series' : 'movie';
  return {
    metaId: state.meta_id,
    imdbId: /^tt\d{7,10}/i.exec(state.meta_id)?.[0] ?? null,
    videoId: null,
    type,
    name: state.name ?? state.meta_id,
    poster: state.poster,
    season: null,
    episode: null,
    progress: 0,
    timeOffsetMs: null,
    durationMs: null,
    watchedVideoId: null,
    lastWatchedAt: state.added_at ?? state.updated_at,
    isFavorite: state.is_favorite === 1,
    isWatchLater: state.is_watch_later === 1,
    inLibrary: state.in_library === 1,
    isLocal: true,
    isAnime:
      isAnimeId(state.meta_id) ||
      mediaIsAnimation(/^tt\d{7,10}/i.exec(state.meta_id)?.[0] ?? null)
  };
}

function statesByMetaId(): Map<string, StremioLibraryStateRow> {
  return new Map(listStremioLibraryStates().map((state) => [state.meta_id, state]));
}

export function listStremioLibrary(): StremioLibraryItemDto[] {
  const states = statesByMetaId();
  const items = listStremioLibraryRows()
    .filter((row) => row.temp === 0)
    .map((row) => toLibraryItem(row, states.get(row.meta_id)));
  const known = new Set(items.map((item) => item.metaId));

  for (const state of states.values()) {
    if (known.has(state.meta_id)) continue;
    if (!state.in_library && !state.is_favorite && !state.is_watch_later) continue;
    items.push(toLocalItem(state));
  }

  return items.sort(sortLibraryItems);
}

export function searchStremioLibrary(query: string): StremioLibraryItemDto[] {
  const term = query.trim();
  if (!term) return [];
  const states = statesByMetaId();
  const items = searchStremioLibraryRows(term).map((row) =>
    toLibraryItem(row, states.get(row.meta_id))
  );
  const known = new Set(items.map((item) => item.metaId));
  const needle = normalizeText(term);

  for (const state of states.values()) {
    if (known.has(state.meta_id) || !state.name) continue;
    if (!state.in_library && !state.is_favorite && !state.is_watch_later) continue;
    if (!normalizeText(state.name).includes(needle)) continue;
    items.push(toLocalItem(state));
  }

  return items.sort(sortLibraryItems);
}

/**
 * Marca/desmarca favorito, "assistir depois" e Minha biblioteca localmente.
 * Nunca altera a conta do Stremio. Títulos fora da biblioteca do Stremio
 * precisam de type/name para serem guardados no Hub.
 */
export function setStremioLibraryItemState(
  metaId: string,
  patch: StremioLibraryStatePatch
): {
  metaId: string;
  isFavorite: boolean;
  isWatchLater: boolean;
  inLibrary: boolean;
} | null {
  const row = getStremioLibraryRow(metaId);
  const existing = getStremioLibraryState(metaId);
  const metaType =
    patch.metaType ??
    (row ? (row.type === 'series' ? 'series' : 'movie') : null) ??
    existing?.meta_type ??
    null;
  const name = patch.name ?? row?.name ?? existing?.name ?? null;
  const poster = patch.poster ?? row?.poster ?? existing?.poster ?? null;
  if (!metaType || !name) return null;

  const state = setStremioLibraryState(metaId, {
    ...patch,
    metaType,
    name,
    poster: poster ?? null
  });
  const isFavorite = state.is_favorite === 1;
  const isWatchLater = state.is_watch_later === 1;
  const inLibrary = state.in_library === 1;

  if (!isFavorite && !isWatchLater && !inLibrary) {
    deleteStremioLibraryState(metaId);
    return { metaId, isFavorite: false, isWatchLater: false, inLibrary: false };
  }

  return { metaId, isFavorite, isWatchLater, inLibrary };
}

/**
 * Importa os títulos da biblioteca como fontes TMDB, sem duplicar:
 * checa a mídia por IMDB e a fonte pelo imdbId/imdbIdOverride.
 */
export async function importStremioLibrary(): Promise<{
  summary: StremioImportResultDto;
  sourceIds: string[];
}> {
  const summary: StremioImportResultDto = { created: 0, skipped: 0, errors: [] };
  const sourceIds: string[] = [];

  if (!hasSecret('tmdb')) {
    summary.errors.push('Configure a chave do TMDB em Configurações → Chaves de API.');
    return { summary, sourceIds };
  }

  const settings = getSettings();
  const rows = listStremioLibraryRows(500).filter(
    (row) =>
      row.temp === 0 &&
      (row.type === 'movie' || row.type === 'series') &&
      row.imdb_id !== null &&
      /^tt\d{7,10}$/i.test(row.imdb_id)
  );

  for (const row of rows.slice(0, 120)) {
    try {
      if (row.imdb_id === null) continue;
      if (findMediaByImdb(row.imdb_id) || findSourceByImdb(row.imdb_id)) {
        summary.skipped++;
        continue;
      }

      const resolved = await tmdbConnector.resolve!(row.imdb_id, settings);
      const externalId = typeof resolved.config.externalId === 'string' ? resolved.config.externalId : '';
      if (externalId && findMediaByExternal('tmdb', externalId)) {
        summary.skipped++;
        continue;
      }

      const source = createSource({
        type: 'tmdb',
        name: resolved.name,
        categoryId: resolved.categoryId,
        config: resolved.config,
        intervalMinutes: 360
      });
      sourceIds.push(source.id);
      summary.created++;
    } catch (error) {
      summary.errors.push(`${row.name}: ${error instanceof Error ? error.message : 'falha ao importar'}`);
      if (summary.errors.length >= 5) break;
    }
  }

  // Animes da biblioteca usam IDs do Kitsu/AniList e normalmente não têm IMDB;
  // nesse caso a fonte é criada pelo AniList, mantendo a categoria Animação/Anime.
  if (summary.errors.length < 5) {
    const animeRows = listStremioLibraryRows(500).filter(
      (row) =>
        row.temp === 0 &&
        (row.type === 'movie' || row.type === 'series') &&
        !/^tt\d{7,10}$/i.test(row.imdb_id ?? '') &&
        isAnimeId(row.meta_id)
    );

    for (const row of animeRows.slice(0, 120)) {
      try {
        const resolved = await anilistConnector.resolve!(row.name, settings);
        const externalId = String(resolved.config.anilistId ?? resolved.config.externalId ?? '');
        if (externalId && findMediaByExternal('anilist', externalId)) {
          summary.skipped++;
          continue;
        }

        const source = createSource({
          type: 'anilist',
          name: resolved.name,
          categoryId: 'anime',
          config: resolved.config,
          intervalMinutes: 180
        });
        sourceIds.push(source.id);
        summary.created++;
      } catch (error) {
        summary.errors.push(
          `${row.name}: ${error instanceof Error ? error.message : 'falha ao importar'}`
        );
        if (summary.errors.length >= 5) break;
      }
    }
  }

  return { summary, sourceIds };
}
