/** Utilidades de estilo e formatação. */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { enUS, es, ptBR } from 'date-fns/locale';
import { SYSTEM_CATEGORIES, type AppLanguage, type SourceType } from '@hub/shared';

const DATE_LOCALES = { pt: ptBR, en: enUS, es } as const;
const INTL_LOCALES: Record<AppLanguage, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES'
};

let appLanguage: AppLanguage = 'pt';

/** O provider de i18n mantém este valor sincronizado com as configurações. */
export function setAppLanguage(language: AppLanguage): void {
  appLanguage = language;
}

export function getAppLanguage(): AppLanguage {
  return appLanguage;
}

export function getDateLocale(): (typeof DATE_LOCALES)[AppLanguage] {
  return DATE_LOCALES[appLanguage];
}

export function getIntlLocale(): string {
  return INTL_LOCALES[appLanguage];
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = date.getTime() - Date.now();
  if (Math.abs(diff) < 60_000) {
    if (appLanguage === 'en') return diff > 0 ? 'in moments' : 'now';
    if (appLanguage === 'es') return diff > 0 ? 'en un momento' : 'ahora';
    return diff > 0 ? 'em instantes' : 'agora';
  }
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: DATE_LOCALES[appLanguage] });
}

/** Tempo relativo compacto para selos: "30 min", "1 h", "1 dia", "2 meses". */
export function formatRelativeCompact(
  iso: string | null | undefined,
  now = Date.now()
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = Math.max(0, now - date.getTime());
  if (diff < 60_000) {
    if (appLanguage === 'en') return 'now';
    if (appLanguage === 'es') return 'ahora';
    return 'agora';
  }

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 30) {
    if (appLanguage === 'en') return `${days} day${days === 1 ? '' : 's'}`;
    if (appLanguage === 'es') return `${days} día${days === 1 ? '' : 's'}`;
    return `${days} dia${days === 1 ? '' : 's'}`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    if (appLanguage === 'en') return `${months} mo`;
    if (appLanguage === 'es') return `${months} ${months === 1 ? 'mes' : 'meses'}`;
    return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  }

  const years = Math.floor(days / 365);
  if (appLanguage === 'en') return `${years} yr${years === 1 ? '' : 's'}`;
  if (appLanguage === 'es') return `${years} año${years === 1 ? '' : 's'}`;
  return `${years} ano${years === 1 ? '' : 's'}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pattern =
    appLanguage === 'en'
      ? 'MMM d, yyyy, h:mm a'
      : appLanguage === 'es'
        ? 'd MMM yyyy, HH:mm'
        : "dd 'de' MMM 'de' yyyy, HH:mm";
  return format(date, pattern, { locale: DATE_LOCALES[appLanguage] });
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pattern =
    appLanguage === 'en' ? 'MMM d, HH:mm' : appLanguage === 'es' ? 'd MMM, HH:mm' : 'dd MMM, HH:mm';
  return format(date, pattern, { locale: DATE_LOCALES[appLanguage] });
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
  }
  const days = minutes / 1440;
  const unit =
    appLanguage === 'en'
      ? days === 1
        ? 'day'
        : 'days'
      : appLanguage === 'es'
        ? days === 1
          ? 'día'
          : 'días'
        : days === 1
          ? 'dia'
          : 'dias';
  return Number.isInteger(days) ? `${days} ${unit}` : `${days.toFixed(1)} ${unit}`;
}

export function categoryColor(id: string): string {
  const found = SYSTEM_CATEGORIES.find((category) => category.id === id);
  if (found) return found.color;
  if (id === 'podcasts') return '#f97316';
  return '#8b96a8';
}

export const SOURCE_TYPE_ICON: Record<SourceType, string> = {
  youtube: 'youtube',
  rss: 'rss',
  tmdb: 'film',
  anilist: 'sparkles',
  'steam-wishlist': 'gamepad-2',
  ggdeals: 'tags',
  webnovel: 'book-open',
  custom: 'link',
  'stremio-library': 'clapperboard',
  'global-releases': 'calendar-days'
};

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Data YYYY-MM-DD no fuso configurado (igual ao backend). */
export function dateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export const MEDIA_COLORS: Record<string, string> = {
  movie: '#f59e0b',
  series: '#38bdf8',
  anime: '#f472b6'
};

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

export function formatMoney(cents: number | null | undefined, currency = 'BRL'): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat(INTL_LOCALES[appLanguage], {
      style: 'currency',
      currency
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function discountPercent(price: number | null | undefined, base: number | null | undefined): number {
  if (!price || !base || base <= 0 || price >= base) return 0;
  return Math.round((1 - price / base) * 100);
}

/** Converte o que o usuário digitou ("79,90", "1.234,56", "79.90") em centavos. */
export function parseMoneyInput(value: string): number | null {
  let normalized = value.trim().replace(/[^\d.,-]/g, '');
  if (!normalized) return null;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  } else if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length > 2 || parts[1]?.length === 3) normalized = parts.join('');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}
