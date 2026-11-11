/**
 * Materializa eventos de calendário em itens do feed.
 *
 * Roda depois de cada sincronização de TMDB/AniList: pega os eventos que
 * aconteceram nos últimos 7 dias (ou hoje, na primeira sincronização) e cria
 * itens com dedupe por chave do evento — nunca duplica.
 */
import type { SettingsDto } from '@hub/shared';
import type { MediaRow, SourceRow } from '../db/types';
import type { RawItem } from '../connectors/types';
import type { ReleaseEventRow } from '../db/types';
import { listEventsForMedia } from '../db/repositories/calendar';
import { addDaysToDate, dateToIso, todayInZone } from '../lib/dates';

const WINDOW_DAYS = 7;

function releaseLabel(event: ReleaseEventRow): string {
  switch (event.kind) {
    case 'cinema':
      return 'Estreia nos cinemas';
    case 'digital':
      return 'Lançamento digital';
    case 'episode':
      return 'Novo episódio';
    case 'airing':
      return 'Episódio no ar';
    default:
      return 'Lançamento';
  }
}

function buildTitle(media: MediaRow, event: ReleaseEventRow): string {
  if (event.kind === 'cinema') return `${media.title} — estreia nos cinemas`;
  if (event.kind === 'digital') return `${media.title} — lançamento digital`;

  const season = event.season ? `S${event.season}` : '';
  const episode = event.episode ? `E${event.episode}` : '';
  const code = `${season}${episode}`;
  return code ? `${media.title} — ${code} no ar` : `${media.title} — novo episódio no ar`;
}

function buildDescription(event: ReleaseEventRow): string {
  const parts = [releaseLabel(event)];
  if (event.episode_title) parts.unshift(event.episode_title);
  if (event.release_time) parts.push(`às ${event.release_time}`);
  if (event.region && (event.kind === 'cinema' || event.kind === 'digital')) {
    parts.push(`região ${event.region}`);
  }
  return parts.join(' · ');
}

export function buildReleaseItems(input: {
  source: SourceRow;
  media: MediaRow;
  settings: SettingsDto;
  firstSync: boolean;
  now?: Date;
}): RawItem[] {
  const now = input.now ?? new Date();
  const today = todayInZone(input.settings.timezone);
  const from = addDaysToDate(today, -WINDOW_DAYS);
  const events = listEventsForMedia(input.media.id, from, today);

  // Na primeira sincronização não despejamos o histórico no feed: só o dia de hoje.
  const selected = input.firstSync ? events.filter((event) => event.release_date === today) : events;

  const items: RawItem[] = [];
  for (const event of selected) {
    // Episódio com horário exato só vira item depois de ir ao ar.
    if (event.release_at && new Date(event.release_at).getTime() > now.getTime()) continue;

    const url = event.url ?? input.media.url;
    if (!url) continue;

    items.push({
      externalId: event.external_key,
      dedupeKey: `release:${event.external_key}`,
      kind: event.kind === 'cinema' || event.kind === 'digital' ? 'release' : 'episode',
      title: buildTitle(input.media, event),
      url,
      thumbnailUrl: input.media.backdrop_url ?? input.media.poster_url,
      description: buildDescription(event),
      author: null,
      publishedAt: event.release_at ?? dateToIso(event.release_date),
      meta: {
        mediaId: input.media.id,
        provider: input.media.provider,
        releaseKind: event.kind,
        season: event.season,
        episode: event.episode,
        region: event.region
      }
    });
  }

  return items;
}
