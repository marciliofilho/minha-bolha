/** Converte itens de catálogo/biblioteca em alvos do player do Feed. */
import type { AddonCatalogItemDto, StremioLibraryItemDto } from '@hub/shared';
import type { StreamTarget } from '@/components/stremio/StreamPicker';

export function streamTargetFromAddonItem(item: AddonCatalogItemDto): StreamTarget {
  const type: 'movie' | 'series' = item.type === 'movie' ? 'movie' : 'series';
  return {
    title: item.name,
    type,
    metaId: item.id,
    imdbId: item.id.startsWith('tt') ? item.id.split(':')[0] ?? null : null,
    poster: item.poster,
    backdrop: null,
    description: item.description,
    year: item.year,
    season: type === 'series' ? 1 : null,
    episode: type === 'series' ? 1 : null
  };
}

export function streamTargetFromLibraryItem(item: StremioLibraryItemDto): StreamTarget {
  return {
    title: item.name,
    type: item.type,
    metaId: item.metaId,
    imdbId: item.imdbId,
    poster: item.poster,
    backdrop: null,
    description: null,
    year: null,
    season: item.type === 'series' ? (item.season && item.season > 0 ? item.season : 1) : null,
    episode: item.type === 'series' ? (item.episode && item.episode > 0 ? item.episode : 1) : null
  };
}
