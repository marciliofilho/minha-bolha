/** Registro central: adicionar um tipo novo é só incluí-lo aqui. */
import type { SourceType } from '@hub/shared';
import type { Connector } from './types';
import { youtubeConnector } from './youtube';
import { rssConnector } from './rss';
import { tmdbConnector } from './tmdb';
import { anilistConnector } from './anilist';
import { steamWishlistConnector } from './steam-wishlist';
import { ggdealsConnector } from './ggdeals';
import { stremioConnector } from './stremio';
import { globalReleasesConnector } from './global-releases';
import { novelsConnector } from './novel';
import { customConnector } from './custom';

export const connectors: Partial<Record<SourceType, Connector>> = {
  youtube: youtubeConnector,
  rss: rssConnector,
  tmdb: tmdbConnector,
  anilist: anilistConnector,
  'steam-wishlist': steamWishlistConnector,
  ggdeals: ggdealsConnector,
  'stremio-library': stremioConnector,
  'global-releases': globalReleasesConnector,
  webnovel: novelsConnector,
  custom: customConnector
};

export function getConnector(type: string): Connector {
  const connector = connectors[type as SourceType];
  if (!connector) {
    throw new Error(`Conector não implementado para o tipo "${type}".`);
  }
  return connector;
}

export function hasConnector(type: string): boolean {
  return Boolean(connectors[type as SourceType]);
}
