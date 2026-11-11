/** Utilitários de data/hora. Tudo é persistido em UTC (ISO 8601). */
export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

/** Vídeos do YouTube só aparecem no feed dentro desta janela. */
export const YOUTUBE_FEED_WINDOW_HOURS = 48;

/** Limite ISO (UTC) para filtrar itens antigos do feed. */
export function feedCutoffIso(hours: number, now = new Date()): string {
  const safeHours = Math.min(Math.max(Math.trunc(hours) || YOUTUBE_FEED_WINDOW_HOURS, 1), 168);
  return new Date(now.getTime() - safeHours * 3_600_000).toISOString();
}

/** Compatibilidade: janela padrão de 48h do YouTube. */
export function youtubeFeedCutoffIso(now = new Date()): string {
  return feedCutoffIso(YOUTUBE_FEED_WINDOW_HOURS, now);
}

// ---------------------------------------------------------------------------
// Datas locais (fuso configurado) — o calendário agrupa por dia local.
// ---------------------------------------------------------------------------

/** Data YYYY-MM-DD de um instante no fuso informado. */
export function dateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/** Hora HH:mm de um instante no fuso informado. */
export function timeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function todayInZone(timeZone: string): string {
  return dateInZone(new Date(), timeZone);
}

/** Soma dias a uma data YYYY-MM-DD (aritmética em UTC para evitar DST). */
export function addDaysToDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Converte uma data YYYY-MM-DD + hora opcional em ISO UTC (meio-dia como padrão). */
export function dateToIso(date: string, time?: string | null, timeZone?: string): string {
  if (time && timeZone) {
    // Interpreta "YYYY-MM-DD HH:mm" no fuso informado usando o offset calculado
    // para aquele instante — suficiente para fontes que só dão data/hora local.
    const naive = new Date(`${date}T${time}:00Z`);
    const offset = zoneOffsetMinutes(naive, timeZone);
    return new Date(naive.getTime() - offset * 60_000).toISOString();
  }
  return `${date}T12:00:00.000Z`;
}

function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Aceita string/número e devolve ISO válido ou null. */
export function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heurística: segundos vs milissegundos.
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
