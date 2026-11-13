/** Backup portátil: exporta/importa seções selecionadas do app. */
import { Router } from 'express';
import { z } from 'zod';
import {
  BACKUP_SECTIONS,
  SOURCE_TYPES,
  updateSettingsSchema,
  type BackupAddonDto,
  type BackupDocumentDto,
  type BackupImportResultDto,
  type BackupPreviewDto,
  type BackupRows,
  type BackupSection
} from '@hub/shared';
import { db } from '../../db/database';
import { getCategory, listCategories, upsertCustomCategory } from '../../db/repositories/categories';
import { getSettings, updateSettings } from '../../db/repositories/settings';
import { importSource, getSourceRow, listSources } from '../../db/repositories/sources';
import { getStremioAccount, saveStremioAccount } from '../../db/repositories/stremio';
import {
  createAddonRow,
  findAddonByUrl,
  getAddonTransportUrl,
  listAddonRows,
  updateAddonRow
} from '../../db/repositories/stremio-addons';
import { nowIso } from '../../lib/dates';
import { encryptSecret, isAppSecretConfigured } from '../../lib/crypto';
import { parseAddonManifest, normalizeAddonUrl } from '../../lib/stremio/addons/manifest';
import { ensureStremioSource, getStremioAuthKey } from '../../lib/stremio/account';
import { rescheduleFeedSources } from '../../scheduler';
import { HttpError, parseBody } from '../errors';

export const backupRouter = Router();

const DEFAULT_SECTIONS: BackupSection[] = ['settings', 'categories', 'sources'];
const SECTION_DEPENDENCIES: Partial<Record<BackupSection, BackupSection[]>> = {
  feed: ['sources', 'categories'],
  calendar: ['sources']
};
const SENSITIVE_SECTIONS = new Set<BackupSection>(['addons', 'apiKeys', 'stremioAccount']);
const ALL_SECTIONS = new Set<BackupSection>(BACKUP_SECTIONS);

const categoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const sourceSchema = z.object({
  id: z.string().trim().min(1).max(64),
  type: z.string().trim().refine((type) => type in SOURCE_TYPES, {
    message: 'Tipo de fonte desconhecido.'
  }),
  name: z.string().trim().min(1).max(200),
  categoryId: categoryIdSchema,
  config: z.record(z.unknown()),
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(5).max(10_080)
});

const categorySchema = z.object({
  id: categoryIdSchema,
  label: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

const addonSchema = z.object({
  transportUrl: z.string().trim().min(1).max(2048),
  manifest: z.record(z.unknown()),
  name: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100_000).optional()
});

const rowsSchema = z.array(z.record(z.unknown())).max(200_000);

const backupSchema = z.object({
  format: z.literal('hub-backup'),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().trim().min(1).max(60),
  sections: z.array(z.enum(BACKUP_SECTIONS)).max(BACKUP_SECTIONS.length).optional(),
  settings: z.record(z.unknown()).optional(),
  categories: z.array(categorySchema).max(500).optional(),
  sources: z.array(sourceSchema).max(2000).optional(),
  addons: z.array(addonSchema).max(500).optional(),
  localLibrary: rowsSchema.optional(),
  playback: rowsSchema.optional(),
  games: rowsSchema.optional(),
  priceHistory: rowsSchema.optional(),
  media: rowsSchema.optional(),
  releaseEvents: rowsSchema.optional(),
  globalReleases: rowsSchema.optional(),
  novelCache: rowsSchema.optional(),
  items: rowsSchema.optional(),
  stremioLibrary: rowsSchema.optional(),
  apiKeys: rowsSchema.optional(),
  stremioAccount: z
    .object({
      email: z.string().trim().max(320).nullable().optional(),
      authKey: z.string().trim().min(1).max(4096)
    })
    .nullable()
    .optional()
});

type BackupBody = z.infer<typeof backupSchema>;

function normalizeSections(value: unknown): BackupSection[] {
  const raw =
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const selected = raw.filter((item): item is BackupSection => ALL_SECTIONS.has(item as BackupSection));
  return selected.length > 0 ? selected : DEFAULT_SECTIONS;
}

/** Inclui dependências (ex.: itens do feed precisam de fontes/categorias). */
function withDependencies(input: BackupSection[]): BackupSection[] {
  const selected = new Set(input);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of [...selected]) {
      for (const dependency of SECTION_DEPENDENCIES[section] ?? []) {
        if (selected.has(dependency)) continue;
        selected.add(dependency);
        changed = true;
      }
    }
  }
  return BACKUP_SECTIONS.filter((section) => selected.has(section));
}

function documentSections(document: BackupBody): Set<BackupSection> {
  if (document.version === 1 || !document.sections) return new Set(DEFAULT_SECTIONS);
  return new Set(document.sections);
}

function rawRows(table: string): BackupRows {
  return db.prepare(`SELECT * FROM "${table}"`).all() as BackupRows;
}

function importableCategories(document: BackupBody) {
  return (document.categories ?? []).filter((category) => {
    const existing = getCategory(category.id);
    return !existing?.isSystem;
  });
}

function validateSettings(settings: Record<string, unknown> | undefined) {
  if (!settings || Object.keys(settings).length === 0) return null;
  return parseBody(updateSettingsSchema, settings);
}

function tableColumns(table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function cellValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

function restoreRows(
  table: string,
  rows: BackupRows | undefined,
  filter?: (row: Record<string, unknown>) => boolean
): number {
  if (!rows || rows.length === 0) return 0;
  const columns = tableColumns(table);
  if (columns.length === 0) return 0;
  const statement = db.prepare(
    `INSERT OR REPLACE INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`
  );
  let count = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (filter && !filter(row)) continue;
    statement.run(...columns.map((column) => cellValue(row[column])));
    count += 1;
  }
  return count;
}

function existingIds(table: string, column: string): Set<string> {
  const rows = db.prepare(`SELECT "${column}" AS id FROM "${table}"`).all() as Array<{
    id: string | null;
  }>;
  return new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)));
}

backupRouter.get('/backup/export', (req, res) => {
  const sections = withDependencies(normalizeSections(req.query.include));
  const selected = new Set(sections);

  const document: BackupDocumentDto = {
    format: 'hub-backup',
    version: 2,
    exportedAt: nowIso(),
    sections
  };

  if (selected.has('settings')) document.settings = getSettings();

  if (selected.has('categories')) {
    document.categories = listCategories()
      .filter((category) => !category.isSystem)
      .map((category) => ({
        id: category.id,
        label: category.label,
        icon: category.icon,
        color: category.color
      }));
  }

  if (selected.has('sources')) {
    document.sources = listSources()
      .filter((source) => !source.isDemo && !SOURCE_TYPES[source.type]?.autoManaged)
      .map((source) => ({
        id: source.id,
        type: source.type,
        name: source.name,
        categoryId: source.categoryId,
        config: source.config,
        enabled: source.enabled,
        intervalMinutes: source.intervalMinutes
      }));
  }

  if (selected.has('addons')) {
    const addons: BackupAddonDto[] = [];
    for (const row of listAddonRows()) {
      try {
        const transportUrl = getAddonTransportUrl(row);
        const manifest = JSON.parse(row.manifest_json) as Record<string, unknown>;
        addons.push({
          transportUrl,
          manifest,
          name: row.name,
          enabled: row.enabled === 1,
          priority: row.priority
        });
      } catch {
        // URL ilegível: não exporta esta entrada
      }
    }
    document.addons = addons;
  }

  const sourceIds = new Set((document.sources ?? []).map((source) => source.id));

  if (selected.has('localLibrary')) document.localLibrary = rawRows('stremio_library_state');
  if (selected.has('playback')) document.playback = rawRows('stremio_playback');
  if (selected.has('stremioLibrary')) document.stremioLibrary = rawRows('stremio_library');
  if (selected.has('novels')) document.novelCache = rawRows('novel_cache');
  if (selected.has('apiKeys')) document.apiKeys = rawRows('secrets');

  if (selected.has('games')) {
    document.games = rawRows('games');
    const gameIds = new Set(
      (document.games ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === 'string')
    );
    document.priceHistory = rawRows('price_history').filter(
      (row) => typeof row.game_id === 'string' && gameIds.has(row.game_id)
    );
  }

  if (selected.has('calendar')) {
    document.media = rawRows('media').filter(
      (row) => typeof row.source_id === 'string' && sourceIds.has(row.source_id)
    );
    const mediaIds = new Set(
      (document.media ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === 'string')
    );
    document.releaseEvents = rawRows('release_events').filter(
      (row) => typeof row.media_id === 'string' && mediaIds.has(row.media_id)
    );
    document.globalReleases = rawRows('global_releases');
  }

  if (selected.has('feed')) {
    document.items = rawRows('items').filter(
      (row) => typeof row.source_id === 'string' && sourceIds.has(row.source_id)
    );
  }

  if (selected.has('stremioAccount')) {
    const authKey = getStremioAuthKey();
    if (authKey) {
      document.stremioAccount = {
        email: getStremioAccount()?.email ?? null,
        authKey
      };
    }
  }

  res.json(document);
});

backupRouter.post('/backup/preview', (req, res) => {
  const document = parseBody(backupSchema, req.body);
  const sections = documentSections(document);
  const sources = document.sources ?? [];
  const existingSources = sources.filter((source) => getSourceRow(source.id)).length;
  const categories = importableCategories(document);
  const existingCategories = categories.filter((category) => getCategory(category.id)).length;

  const countFor = (section: BackupSection): number => {
    switch (section) {
      case 'settings':
        return document.settings ? Object.keys(document.settings).length : 0;
      case 'categories':
        return categories.length;
      case 'sources':
        return sources.length;
      case 'addons':
        return document.addons?.length ?? 0;
      case 'localLibrary':
        return document.localLibrary?.length ?? 0;
      case 'playback':
        return document.playback?.length ?? 0;
      case 'games':
        return (document.games?.length ?? 0) + (document.priceHistory?.length ?? 0);
      case 'calendar':
        return (
          (document.media?.length ?? 0) +
          (document.releaseEvents?.length ?? 0) +
          (document.globalReleases?.length ?? 0)
        );
      case 'novels':
        return document.novelCache?.length ?? 0;
      case 'feed':
        return document.items?.length ?? 0;
      case 'stremioLibrary':
        return document.stremioLibrary?.length ?? 0;
      case 'apiKeys':
        return document.apiKeys?.length ?? 0;
      case 'stremioAccount':
        return document.stremioAccount?.authKey ? 1 : 0;
      default:
        return 0;
    }
  };

  const preview: BackupPreviewDto = {
    exportedAt: document.exportedAt,
    sources: {
      total: sources.length,
      new: sources.length - existingSources,
      existing: existingSources
    },
    categories: {
      total: categories.length,
      new: categories.length - existingCategories,
      existing: existingCategories
    },
    settingsFields: document.settings ? Object.keys(document.settings).length : 0,
    sections: BACKUP_SECTIONS.filter((section) => sections.has(section))
      .map((section) => ({
        id: section,
        count: countFor(section),
        sensitive: SENSITIVE_SECTIONS.has(section)
      }))
      .filter((section) => section.count > 0)
  };

  res.json(preview);
});

backupRouter.post('/backup/import', (req, res) => {
  const document = parseBody(backupSchema, req.body);
  const sections = documentSections(document);
  const result: BackupImportResultDto = {
    sourcesCreated: 0,
    sourcesUpdated: 0,
    categoriesImported: 0,
    settingsUpdated: false,
    sections: {}
  };

  if (sections.has('settings') && document.settings) {
    const settings = validateSettings(document.settings);
    if (settings) {
      updateSettings(settings);
      if (settings.feedRefreshSeconds !== undefined) rescheduleFeedSources();
      result.settingsUpdated = true;
      result.sections!.settings = Object.keys(document.settings).length;
    }
  }

  if (sections.has('categories') && document.categories) {
    for (const category of importableCategories(document)) {
      upsertCustomCategory(category);
      result.categoriesImported += 1;
    }
    result.sections!.categories = result.categoriesImported;
  }

  if (sections.has('sources') && document.sources) {
    for (const source of document.sources) {
      const categoryId = getCategory(source.categoryId) ? source.categoryId : 'other';
      const imported = importSource({
        id: source.id,
        type: source.type as keyof typeof SOURCE_TYPES,
        name: source.name,
        categoryId,
        config: source.config,
        enabled: source.enabled,
        intervalMinutes: source.intervalMinutes
      });
      if (imported.created) result.sourcesCreated += 1;
      else result.sourcesUpdated += 1;
    }
    result.sections!.sources = document.sources.length;
  }

  if (sections.has('addons') && document.addons) {
    let created = 0;
    let updated = 0;
    for (const addon of document.addons) {
      try {
        const transportUrl = normalizeAddonUrl(addon.transportUrl);
        const manifest = parseAddonManifest(addon.manifest);
        const existing = findAddonByUrl(transportUrl);
        if (existing) {
          updateAddonRow(existing.id, {
            manifest,
            name: addon.name,
            enabled: addon.enabled,
            priority: addon.priority
          });
          updated += 1;
        } else {
          const row = createAddonRow({
            transportUrl,
            manifest,
            name: addon.name,
            priority: addon.priority
          });
          if (addon.enabled === false) updateAddonRow(row.id, { enabled: false });
          created += 1;
        }
      } catch {
        // Addon inválido: não impede a restauração dos demais
      }
    }
    result.sections!.addons = created + updated;
  }

  const rawSections =
    sections.has('localLibrary') ||
    sections.has('playback') ||
    sections.has('games') ||
    sections.has('calendar') ||
    sections.has('novels') ||
    sections.has('feed') ||
    sections.has('stremioLibrary') ||
    sections.has('apiKeys');

  if (rawSections) {
    db.exec('BEGIN');
    try {
      if (sections.has('localLibrary') && document.localLibrary) {
        result.sections!.localLibrary = restoreRows('stremio_library_state', document.localLibrary);
      }
      if (sections.has('playback') && document.playback) {
        result.sections!.playback = restoreRows('stremio_playback', document.playback);
      }
      if (sections.has('novels') && document.novelCache) {
        result.sections!.novels = restoreRows('novel_cache', document.novelCache);
      }
      if (sections.has('stremioLibrary') && document.stremioLibrary) {
        result.sections!.stremioLibrary = restoreRows('stremio_library', document.stremioLibrary);
      }
      if (sections.has('apiKeys') && document.apiKeys) {
        result.sections!.apiKeys = restoreRows('secrets', document.apiKeys);
      }
      if (sections.has('games')) {
        const games = restoreRows('games', document.games);
        const gameIds = existingIds('games', 'id');
        const priceHistory = restoreRows('price_history', document.priceHistory, (row) =>
          typeof row.game_id === 'string' && gameIds.has(row.game_id)
        );
        result.sections!.games = games + priceHistory;
      }
      if (sections.has('calendar')) {
        const sourceIds = existingIds('sources', 'id');
        const media = restoreRows('media', document.media, (row) =>
          typeof row.source_id === 'string' && sourceIds.has(row.source_id)
        );
        const mediaIds = existingIds('media', 'id');
        const releaseEvents = restoreRows('release_events', document.releaseEvents, (row) =>
          typeof row.media_id === 'string' && mediaIds.has(row.media_id)
        );
        const globalReleases = restoreRows('global_releases', document.globalReleases);
        result.sections!.calendar = media + releaseEvents + globalReleases;
      }
      if (sections.has('feed')) {
        const sourceIds = existingIds('sources', 'id');
        const categoryIds = existingIds('categories', 'id');
        result.sections!.feed = restoreRows(
          'items',
          document.items,
          (row) =>
            typeof row.source_id === 'string' &&
            sourceIds.has(row.source_id) &&
            typeof row.category_id === 'string' &&
            categoryIds.has(row.category_id)
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  if (sections.has('stremioAccount') && document.stremioAccount?.authKey) {
    if (!isAppSecretConfigured()) {
      throw new HttpError(
        422,
        'APP_SECRET não está configurado; não é possível restaurar a conta do Stremio.',
        'config'
      );
    }
    saveStremioAccount(
      document.stremioAccount.email ?? null,
      encryptSecret(document.stremioAccount.authKey)
    );
    ensureStremioSource();
    result.sections!.stremioAccount = 1;
  }

  res.json(result);
});
