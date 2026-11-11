/**
 * Schemas Zod compartilhados: a API valida tudo que chega do frontend
 * com estes mesmos contratos.
 */
import { z } from 'zod';

const SOURCE_TYPE_VALUES = [
  'youtube',
  'rss',
  'tmdb',
  'anilist',
  'steam-wishlist',
  'ggdeals',
  'webnovel',
  'custom',
  'stremio-library',
  'global-releases'
] as const;

const categoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use apenas letras minúsculas, números e hífen.');

const imdbIdSchema = z
  .string()
  .trim()
  .regex(/^tt\d{7,10}$/i, 'Use um ID do IMDB no formato tt1234567.');

export const createSourceSchema = z.object({
  type: z.enum(SOURCE_TYPE_VALUES),
  /** URL, handle, ID do IMDB, nome de anime etc., dependendo do tipo. */
  input: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(120).optional(),
  categoryId: categoryIdSchema,
  intervalMinutes: z.number().int().min(5).max(1440).optional(),
  /** Correção manual do IMDB (útil para animes sem ID no AniList). */
  imdbId: z.union([z.literal(''), imdbIdSchema]).optional()
});

export const updateSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    categoryId: categoryIdSchema,
    intervalMinutes: z.number().int().min(5).max(1440),
    enabled: z.boolean(),
    /** Permite trocar a URL/canal; o backend resolve de novo. */
    input: z.string().trim().min(1).max(2048),
    imdbId: z.union([z.literal(''), imdbIdSchema])
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nenhum campo para atualizar.'
  });

export const resolveSourceSchema = z.object({
  type: z.enum(SOURCE_TYPE_VALUES),
  input: z.string().trim().min(1).max(2048)
});

export const novelProgressSchema = z.object({
  chapterId: z.string().trim().min(1).max(64),
  chapterIndex: z.number().min(0).max(1_000_000).nullable().optional(),
  chapterName: z.string().trim().min(1).max(300)
});

export const updateItemSchema = z
  .object({
    isRead: z.boolean(),
    isFavorite: z.boolean(),
    isWatchLater: z.boolean()
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nenhum campo para atualizar.'
  });

export const markAllReadSchema = z.object({
  tab: z.string().trim().min(1).max(40).default('all'),
  sourceId: z.string().trim().min(1).max(64).optional()
});

export const updateSettingsSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']),
    defaultIntervalMinutes: z.number().int().min(5).max(1440),
    feedRefreshSeconds: z.number().int().min(60).max(3600),
    hoverPreviewSeconds: z.number().int().min(0).max(15),
    feedWindowHours: z.number().int().min(1).max(168),
    novelCacheRetentionHours: z.number().int().min(1).max(720),
    novelCacheCleanupHours: z.number().int().min(1).max(168),
    novelChaptersOffline: z.boolean(),
    novelOfflineRetentionDays: z.number().int().min(1).max(365),
    language: z.enum(['pt', 'en', 'es']),
    introEnabled: z.boolean(),
    introAudio: z.boolean(),
    timezone: z.string().trim().min(1).max(80),
    region: z.string().trim().min(2).max(8),
    currency: z.string().trim().min(3).max(3),
    streamCacheTtlHours: z.number().int().min(1).max(168),
    torrentCacheRetentionDays: z.number().int().min(0).max(365),
    autoMaintenanceEnabled: z.boolean(),
    playerSkipSeconds: z.number().int().min(1).max(120),
    subtitleLanguage: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9-]{2,12}|off)$/),
    subtitleFontSize: z.number().int().min(12).max(48),
    subtitleColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
    subtitleBackgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
    subtitleBackgroundOpacity: z.number().int().min(0).max(100),
    subtitleLineHeight: z.number().min(0.8).max(2.5),
    subtitlePosition: z.number().int().min(40).max(95)
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nenhum campo para atualizar.'
  });

export const importWishlistSchema = z.object({
  input: z.string().trim().min(1).max(512)
});

export const addGameSchema = z.object({
  appid: z.number().int().positive(),
  targetPriceCents: z.number().int().min(0).max(100_000_000).nullable().optional()
});

export const updateGameSchema = z.object({
  targetPriceCents: z.number().int().min(0).max(100_000_000).nullable()
});

export type CreateSourceInput = z.infer<typeof createSourceSchema>;
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ImportWishlistInput = z.infer<typeof importWishlistSchema>;
export type AddGameInput = z.infer<typeof addGameSchema>;
export type UpdateGameInput = z.infer<typeof updateGameSchema>;
