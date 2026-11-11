/** Calendário de lançamentos e episódios (locais + globais). */
import { Router } from 'express';
import type { CalendarResponseDto } from '@hub/shared';
import { listCalendarEvents } from '../../db/repositories/calendar';
import { listGlobalReleases } from '../../db/repositories/global-releases';
import { toGlobalReleaseEventDto, toReleaseEventDto } from '../../db/mappers';
import { getSettings } from '../../db/repositories/settings';
import { ensureGlobalReleasesSource } from '../../domain/global-releases';
import { enqueueSource } from '../../scheduler';
import { addDaysToDate, todayInZone } from '../../lib/dates';
import { HttpError } from '../errors';

export const calendarRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS = new Set(['movie', 'series', 'anime']);
const MAX_RANGE_DAYS = 370;

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

calendarRouter.get('/calendar/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2) {
    throw new HttpError(400, 'Digite pelo menos 2 caracteres para buscar.', 'validation');
  }
  if (query.length > 100) {
    throw new HttpError(400, 'Busca grande demais.', 'validation');
  }

  const settings = getSettings();
  const today = todayInZone(settings.timezone);
  const from = addDaysToDate(today, -400);
  const to = addDaysToDate(today, 400);
  const scope = req.query.scope === 'library' ? 'library' : 'global';

  const events =
    scope === 'library'
      ? listCalendarEvents({ from, to }).map(toReleaseEventDto)
      : listGlobalReleases({ from, to }).map(toGlobalReleaseEventDto);

  const needle = normalizeSearch(query);
  const matches = events
    .filter((event) =>
      normalizeSearch(
        [event.title, event.originalTitle, event.episodeTitle, event.sourceName]
          .filter(Boolean)
          .join(' ')
      ).includes(needle)
    )
    .slice(0, 100);

  const payload: CalendarResponseDto = { from, to, events: matches };
  res.json(payload);
});

calendarRouter.get('/calendar', (req, res) => {
  const settings = getSettings();
  const today = todayInZone(settings.timezone);

  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : today;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : addDaysToDate(from, 30);

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new HttpError(400, 'Datas devem estar no formato YYYY-MM-DD.', 'validation');
  }
  const span = daysBetween(from, to);
  if (span < 0) throw new HttpError(400, '"from" precisa ser anterior a "to".', 'validation');
  if (span > MAX_RANGE_DAYS) throw new HttpError(400, 'Intervalo máximo de 370 dias.', 'validation');

  const typesParam = typeof req.query.types === 'string' ? req.query.types : '';
  const kinds = typesParam
    .split(',')
    .map((value) => value.trim())
    .filter((value) => VALID_KINDS.has(value));

  const scope = req.query.scope === 'library' ? 'library' : 'global';

  // "global" mostra o catálogo independente da biblioteca; "library" mostra
  // somente os títulos/fontes que o usuário acompanha.
  const events =
    scope === 'library'
      ? listCalendarEvents({ from, to, kinds: kinds.length > 0 ? kinds : undefined }).map(toReleaseEventDto)
      : listGlobalReleases({ from, to, kinds: kinds.length > 0 ? kinds : undefined }).map(
          toGlobalReleaseEventDto
        );

  const payload: CalendarResponseDto = {
    from,
    to,
    events
  };

  res.json(payload);
});

/** Força uma nova sincronização do calendário global. */
calendarRouter.post('/calendar/refresh', (_req, res) => {
  const source = ensureGlobalReleasesSource();
  const queued = enqueueSource(source.id, true);
  res.status(202).json({ queued });
});
