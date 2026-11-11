/** Backup portátil: exporta/importa fontes, categorias e configurações. */
import { Router } from 'express';
import { z } from 'zod';
import {
  SOURCE_TYPES,
  updateSettingsSchema,
  type BackupDocumentDto,
  type BackupImportResultDto,
  type BackupPreviewDto
} from '@hub/shared';
import { getCategory, listCategories, upsertCustomCategory } from '../../db/repositories/categories';
import { getSettings, updateSettings } from '../../db/repositories/settings';
import { importSource, getSourceRow, listSources } from '../../db/repositories/sources';
import { nowIso } from '../../lib/dates';
import { rescheduleFeedSources } from '../../scheduler';
import { parseBody } from '../errors';

export const backupRouter = Router();

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

const backupSchema = z.object({
  format: z.literal('hub-backup'),
  version: z.literal(1),
  exportedAt: z.string().trim().min(1).max(60),
  settings: z.record(z.unknown()),
  categories: z.array(categorySchema).max(500),
  sources: z.array(sourceSchema).max(2000)
});

function importableCategories(document: z.infer<typeof backupSchema>) {
  return document.categories.filter((category) => {
    const existing = getCategory(category.id);
    return !existing?.isSystem;
  });
}

function validateSettings(document: z.infer<typeof backupSchema>) {
  if (Object.keys(document.settings).length === 0) return null;
  return parseBody(updateSettingsSchema, document.settings);
}

backupRouter.get('/backup/export', (_req, res) => {
  const sources = listSources()
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

  const categories = listCategories()
    .filter((category) => !category.isSystem)
    .map((category) => ({
      id: category.id,
      label: category.label,
      icon: category.icon,
      color: category.color
    }));

  const document: BackupDocumentDto = {
    format: 'hub-backup',
    version: 1,
    exportedAt: nowIso(),
    settings: getSettings(),
    categories,
    sources
  };
  res.json(document);
});

backupRouter.post('/backup/preview', (req, res) => {
  const document = parseBody(backupSchema, req.body);
  const sources = document.sources;
  const existingSources = sources.filter((source) => getSourceRow(source.id)).length;
  const categories = importableCategories(document);
  const existingCategories = categories.filter((category) => getCategory(category.id)).length;

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
    settingsFields: Object.keys(document.settings).length
  };
  res.json(preview);
});

backupRouter.post('/backup/import', (req, res) => {
  const document = parseBody(backupSchema, req.body);
  const settings = validateSettings(document);

  let categoriesImported = 0;
  for (const category of importableCategories(document)) {
    upsertCustomCategory(category);
    categoriesImported += 1;
  }

  let sourcesCreated = 0;
  let sourcesUpdated = 0;
  for (const source of document.sources) {
    const categoryId = getCategory(source.categoryId) ? source.categoryId : 'other';
    const result = importSource({
      id: source.id,
      type: source.type as keyof typeof SOURCE_TYPES,
      name: source.name,
      categoryId,
      config: source.config,
      enabled: source.enabled,
      intervalMinutes: source.intervalMinutes
    });
    if (result.created) sourcesCreated += 1;
    else sourcesUpdated += 1;
  }

  let settingsUpdated = false;
  if (settings) {
    updateSettings(settings);
    if (settings.feedRefreshSeconds !== undefined) rescheduleFeedSources();
    settingsUpdated = true;
  }

  const payload: BackupImportResultDto = {
    sourcesCreated,
    sourcesUpdated,
    categoriesImported,
    settingsUpdated
  };
  res.json(payload);
});
