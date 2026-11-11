/** Configurações do app, persistidas como chave/valor JSON. */
import { db } from '../database';
import type { SettingsDto } from '@hub/shared';
import { env } from '../../config/env';
import { nowIso } from '../../lib/dates';

const KEYS = [
  'theme',
  'language',
  'introEnabled',
  'introAudio',
  'defaultIntervalMinutes',
  'feedRefreshSeconds',
  'hoverPreviewSeconds',
  'feedWindowHours',
  'novelCacheRetentionHours',
  'novelCacheCleanupHours',
  'novelChaptersOffline',
  'novelOfflineRetentionDays',
  'timezone',
  'region',
  'currency',
  'streamCacheTtlHours',
  'torrentCacheRetentionDays',
  'autoMaintenanceEnabled',
  'playerSkipSeconds',
  'subtitleLanguage',
  'subtitleFontSize',
  'subtitleColor',
  'subtitleBackgroundColor',
  'subtitleBackgroundOpacity',
  'subtitleLineHeight',
  'subtitlePosition'
] as const;
type SettingKey = (typeof KEYS)[number];

export const DEFAULT_SETTINGS: SettingsDto = {
  theme: 'dark',
  language: 'pt',
  introEnabled: true,
  introAudio: true,
  defaultIntervalMinutes: 30,
  feedRefreshSeconds: 300,
  hoverPreviewSeconds: 3,
  feedWindowHours: 48,
  novelCacheRetentionHours: 168,
  novelCacheCleanupHours: 6,
  novelChaptersOffline: true,
  novelOfflineRetentionDays: 7,
  timezone: env.timezone,
  region: 'BR',
  currency: 'BRL',
  streamCacheTtlHours: 24,
  torrentCacheRetentionDays: 7,
  autoMaintenanceEnabled: true,
  playerSkipSeconds: 10,
  subtitleLanguage: 'por',
  subtitleFontSize: 22,
  subtitleColor: '#ffffff',
  subtitleBackgroundColor: '#000000',
  subtitleBackgroundOpacity: 65,
  subtitleLineHeight: 1.32,
  subtitlePosition: 85
};

export function getSettings(): SettingsDto {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{ key: string; value: string }>;
  const stored = new Map<string, unknown>();
  for (const row of rows) {
    try {
      stored.set(row.key, JSON.parse(row.value));
    } catch {
      // valor corrompido: ignora e usa o padrão
    }
  }

  return {
    theme: parseTheme(stored.get('theme')),
    language: parseAppLanguage(stored.get('language')),
    introEnabled: parseBoolean(stored.get('introEnabled'), DEFAULT_SETTINGS.introEnabled),
    introAudio: parseBoolean(stored.get('introAudio'), DEFAULT_SETTINGS.introAudio),
    defaultIntervalMinutes: clampInterval(stored.get('defaultIntervalMinutes')),
    feedRefreshSeconds: clampNumber(
      stored.get('feedRefreshSeconds'),
      DEFAULT_SETTINGS.feedRefreshSeconds,
      60,
      3600
    ),
    hoverPreviewSeconds: clampNumber(
      stored.get('hoverPreviewSeconds'),
      DEFAULT_SETTINGS.hoverPreviewSeconds,
      0,
      15
    ),
    feedWindowHours: clampNumber(
      stored.get('feedWindowHours'),
      DEFAULT_SETTINGS.feedWindowHours,
      1,
      168
    ),
    novelCacheRetentionHours: clampNumber(
      stored.get('novelCacheRetentionHours'),
      DEFAULT_SETTINGS.novelCacheRetentionHours,
      1,
      720
    ),
    novelCacheCleanupHours: clampNumber(
      stored.get('novelCacheCleanupHours'),
      DEFAULT_SETTINGS.novelCacheCleanupHours,
      1,
      168
    ),
    novelChaptersOffline: parseBoolean(
      stored.get('novelChaptersOffline'),
      DEFAULT_SETTINGS.novelChaptersOffline
    ),
    novelOfflineRetentionDays: clampNumber(
      stored.get('novelOfflineRetentionDays'),
      DEFAULT_SETTINGS.novelOfflineRetentionDays,
      1,
      365
    ),
    timezone: typeof stored.get('timezone') === 'string' ? (stored.get('timezone') as string) : DEFAULT_SETTINGS.timezone,
    region: typeof stored.get('region') === 'string' ? (stored.get('region') as string) : DEFAULT_SETTINGS.region,
    currency: typeof stored.get('currency') === 'string' ? (stored.get('currency') as string) : DEFAULT_SETTINGS.currency,
    streamCacheTtlHours: clampNumber(
      stored.get('streamCacheTtlHours'),
      DEFAULT_SETTINGS.streamCacheTtlHours,
      1,
      168
    ),
    torrentCacheRetentionDays: clampNumber(
      stored.get('torrentCacheRetentionDays'),
      DEFAULT_SETTINGS.torrentCacheRetentionDays,
      0,
      365
    ),
    autoMaintenanceEnabled: parseBoolean(
      stored.get('autoMaintenanceEnabled'),
      DEFAULT_SETTINGS.autoMaintenanceEnabled
    ),
    playerSkipSeconds: clampNumber(
      stored.get('playerSkipSeconds'),
      DEFAULT_SETTINGS.playerSkipSeconds,
      1,
      120
    ),
    subtitleLanguage: parseLanguage(stored.get('subtitleLanguage')),
    subtitleFontSize: clampNumber(
      stored.get('subtitleFontSize'),
      DEFAULT_SETTINGS.subtitleFontSize,
      12,
      48
    ),
    subtitleColor: parseColor(stored.get('subtitleColor'), DEFAULT_SETTINGS.subtitleColor),
    subtitleBackgroundColor: parseColor(
      stored.get('subtitleBackgroundColor'),
      DEFAULT_SETTINGS.subtitleBackgroundColor
    ),
    subtitleBackgroundOpacity: clampNumber(
      stored.get('subtitleBackgroundOpacity'),
      DEFAULT_SETTINGS.subtitleBackgroundOpacity,
      0,
      100
    ),
    subtitleLineHeight: clampDecimal(
      stored.get('subtitleLineHeight'),
      DEFAULT_SETTINGS.subtitleLineHeight,
      0.8,
      2.5
    ),
    subtitlePosition: clampNumber(
      stored.get('subtitlePosition'),
      DEFAULT_SETTINGS.subtitlePosition,
      40,
      95
    )
  };
}

/** Aplica o idioma escolhido no primeiro boot, se ainda não houver idioma salvo. */
export function applyInitialLanguage(): void {
  const language = process.env.HUB_INITIAL_LANGUAGE?.trim().toLowerCase();
  if (language !== 'pt' && language !== 'en' && language !== 'es') return;

  const existing = db.prepare("SELECT 1 FROM settings WHERE key = 'language'").get();
  if (existing) return;

  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('language', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(JSON.stringify(language), nowIso());
}

export function updateSettings(patch: Partial<SettingsDto>): SettingsDto {
  const statement = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  db.exec('BEGIN');
  try {
    for (const key of KEYS) {
      const value = patch[key];
      if (value !== undefined) {
        statement.run(key, JSON.stringify(value), nowIso());
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getSettings();
}

function parseTheme(value: unknown): SettingsDto['theme'] {
  return value === 'light' || value === 'system' || value === 'dark' ? value : DEFAULT_SETTINGS.theme;
}

function parseAppLanguage(value: unknown): SettingsDto['language'] {
  return value === 'en' || value === 'es' || value === 'pt' ? value : DEFAULT_SETTINGS.language;
}

function clampInterval(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.defaultIntervalMinutes;
  return Math.min(Math.max(Math.round(number), 5), 1440);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function clampDecimal(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(Math.max(number, min), max) * 100) / 100;
}

function parseColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

function parseLanguage(value: unknown): string {
  return typeof value === 'string' && /^([a-z0-9-]{2,12}|off)$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_SETTINGS.subtitleLanguage;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
