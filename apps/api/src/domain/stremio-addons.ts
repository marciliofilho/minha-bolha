/**
 * Addons do Stremio: cadastro manual, importação da conta, catálogos,
 * metadados, diagnóstico e agregação de streams (somente leitura).
 */
import type {
  AddonCatalogDto,
  AddonCatalogGroupDto,
  AddonCatalogItemDto,
  AddonCatalogPageDto,
  AddonImportResultDto,
  AddonSearchResultDto,
  AddonStreamSummaryDto,
  AddonTestSummaryDto,
  StremioAddonDto,
  StremioAudioTrackDto,
  StremioCardInfoDto,
  StremioProbeDto,
  TitleStreamDto,
  TitleStreamsDto,
  TitleStreamKind,
  TitleSubtitleDto,
  TitleSubtitlesDto
} from '@hub/shared';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { StremioAddonRow } from '../db/types';
import {
  createAddonRow,
  deleteAddonRow,
  findAddonByUrl,
  getAddonManifest,
  getAddonRow,
  getAddonTransportUrl,
  listAddonRows,
  nextAddonPriority,
  reorderAddonRows,
  setAddonTestState,
  updateAddonRow
} from '../db/repositories/stremio-addons';
import { listStremioLibraryRows } from '../db/repositories/stremio';
import { getSettings } from '../db/repositories/settings';
import {
  deleteOldStreamCache,
  getStreamCacheRow,
  pruneStreamCache,
  saveStreamCacheRow
} from '../db/repositories/stream-cache';
import { createLogger } from '../lib/logger';
import { env } from '../config/env';
import { fetchStremioAddonCollection } from '../lib/stremio/api';
import { getStremioAuthKey } from '../lib/stremio/account';
import { isAppSecretConfigured } from '../lib/crypto';
import { ConnectorError } from '../connectors/types';
import { fetchTitleDetails } from '../connectors/tmdb';
import { fetchAniListTrailer } from '../connectors/anilist';
import {
  fetchAddonCatalog,
  fetchAddonMeta,
  fetchAddonStreams,
  fetchAddonSubtitles,
  loadAddonManifest,
  supportsResource,
  toCatalogItemDto,
  type AddonManifest,
  type NormalizedMeta,
  type NormalizedStream
} from '../connectors/stremio-addons';
import { getStremioServerUrl, getStremioServerStatus } from '../lib/stremio/server';
import { subtitleLanguageName, subtitleLanguageRank } from '../lib/stremio/subtitles';
import { AddonHttpError } from '../lib/stremio/addons/http';
import {
  manifestCatalogs,
  manifestResources,
  maskAddonUrl,
  normalizeAddonUrl,
  parseAddonManifest,
  resourceCapability
} from '../lib/stremio/addons/manifest';

interface EnabledAddon {
  id: string;
  name: string;
  priority: number;
  transportUrl: string;
  manifest: AddonManifest;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function safeMask(row: StremioAddonRow): string {
  try {
    return maskAddonUrl(getAddonTransportUrl(row));
  } catch {
    return '••••';
  }
}

function toAddonDto(row: ReturnType<typeof getAddonRow>): StremioAddonDto {
  if (!row) throw new ConnectorError('not_found', 'Addon não encontrado.');
  let manifest: AddonManifest | null = null;
  try {
    manifest = getAddonManifest(row);
  } catch {
    manifest = null;
  }

  return {
    id: row.id,
    addonId: row.addon_id,
    name: row.name,
    version: row.version,
    description: row.description,
    logo: manifest?.logo ?? null,
    background: manifest?.background ?? null,
    maskedUrl: safeMask(row),
    resources: manifest ? manifestResources(manifest) : [],
    types: manifest?.types ?? [],
    idPrefixes: manifest?.idPrefixes ?? [],
    catalogs: manifest ? manifestCatalogs(manifest) : [],
    enabled: row.enabled === 1,
    priority: row.priority,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok === null ? null : row.last_test_ok === 1,
    lastTestError: row.last_test_error,
    lastTestSummary: parseJson<AddonTestSummaryDto>(row.last_test_summary),
    createdAt: row.created_at
  };
}

export function listAddons(): StremioAddonDto[] {
  return listAddonRows().map((row) => toAddonDto(row));
}

function getEnabledAddons(): EnabledAddon[] {
  const result: EnabledAddon[] = [];
  for (const row of listAddonRows(true)) {
    try {
      result.push({
        id: row.id,
        name: row.name,
        priority: row.priority,
        transportUrl: getAddonTransportUrl(row),
        manifest: getAddonManifest(row)
      });
    } catch {
      // Addon corrompido/segredo ilegível não pode derrubar os demais.
    }
  }
  return result;
}

function requireAddon(id: string) {
  const row = getAddonRow(id);
  if (!row) throw new ConnectorError('not_found', 'Addon não encontrado.');
  return row;
}

function ensureSecret(): void {
  if (!isAppSecretConfigured()) {
    throw new ConnectorError(
      'config',
      'Configure APP_SECRET no .env (mín. 16 caracteres) para criptografar a URL dos addons.'
    );
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function addAddon(rawUrl: string): Promise<StremioAddonDto> {
  ensureSecret();
  const transportUrl = normalizeAddonUrl(rawUrl);
  if (findAddonByUrl(transportUrl)) {
    throw new ConnectorError('config', 'Este addon já está cadastrado.');
  }

  const { manifest } = await loadAddonManifest(transportUrl);
  const row = createAddonRow({
    transportUrl,
    manifest,
    priority: nextAddonPriority()
  });
  return toAddonDto(row);
}

export async function updateAddon(
  id: string,
  patch: { url?: string; name?: string; enabled?: boolean; priority?: number }
): Promise<StremioAddonDto> {
  const row = requireAddon(id);
  let transportUrl: string | undefined;
  let manifest: AddonManifest | undefined;

  if (patch.url !== undefined) {
    ensureSecret();
    transportUrl = normalizeAddonUrl(patch.url);
    const duplicate = findAddonByUrl(transportUrl);
    if (duplicate && duplicate.id !== id) {
      throw new ConnectorError('config', 'Já existe outro addon com esta URL.');
    }
    manifest = (await loadAddonManifest(transportUrl)).manifest;
  }

  const updated = updateAddonRow(id, {
    transportUrl,
    manifest,
    name: patch.name,
    enabled: patch.enabled,
    priority: patch.priority
  });
  return toAddonDto(updated);
}

export function removeAddon(id: string): void {
  requireAddon(id);
  deleteAddonRow(id);
}

export function reorderAddons(ids: string[]): StremioAddonDto[] {
  const existing = listAddonRows().map((row) => row.id);
  const unique = new Set(ids);
  const valid =
    ids.length === existing.length &&
    unique.size === ids.length &&
    ids.every((id) => existing.includes(id));
  if (!valid) {
    throw new ConnectorError('config', 'A lista de reordenação precisa conter todos os addons.');
  }
  reorderAddonRows(ids);
  return listAddons();
}

export async function importAddonsFromAccount(): Promise<AddonImportResultDto> {
  ensureSecret();
  const authKey = getStremioAuthKey();
  if (!authKey) {
    throw new ConnectorError('auth', 'Conecte sua conta do Stremio em Configurações → Stremio.');
  }

  const descriptors = await fetchStremioAddonCollection(authKey);
  const summary: AddonImportResultDto = { created: 0, skipped: 0, errors: [] };
  let priority = nextAddonPriority();

  for (const descriptor of descriptors.slice(0, 120)) {
    let masked = 'addon';
    try {
      const transportUrl = normalizeAddonUrl(descriptor.transportUrl);
      masked = maskAddonUrl(transportUrl);
      if (findAddonByUrl(transportUrl)) {
        summary.skipped++;
        continue;
      }

      let manifest: AddonManifest;
      try {
        manifest = parseAddonManifest(descriptor.manifest);
      } catch {
        manifest = (await loadAddonManifest(transportUrl)).manifest;
      }

      createAddonRow({ transportUrl, manifest, priority });
      priority += 10;
      summary.created++;
    } catch (error) {
      summary.errors.push(
        `${masked}: ${error instanceof Error ? error.message : 'falha ao importar'}`
      );
      if (summary.errors.length >= 5) break;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

interface Sample {
  type: string;
  id: string;
  videoId: string;
  title: string | null;
  catalogsTested: number;
}

function firstPlayableVideo(meta: NormalizedMeta): { id: string } | null {
  const videos = meta.videos.filter((video) => video.id);
  const episode = videos.find((video) => (video.season ?? 0) > 0);
  return episode ?? videos[0] ?? null;
}

async function pickSample(
  transportUrl: string,
  manifest: AddonManifest
): Promise<Sample | null> {
  const catalogs = manifestCatalogs(manifest)
    .filter((catalog) => catalog.extraRequired.every((extra) => extra === 'skip'))
    .slice(0, 3);
  let catalogsTested = 0;

  for (const catalog of catalogs) {
    try {
      const extra: Record<string, string | number | undefined> = catalog.extraRequired.includes('skip')
        ? { skip: 0 }
        : {};
      const page = await fetchAddonCatalog(transportUrl, catalog, extra);
      catalogsTested++;
      const item = page.items[0];
      if (!item) continue;

      let videoId = item.id;
      if (item.type !== 'movie') {
        if (supportsResource(manifest, 'meta', item.type, item.id)) {
          try {
            const meta = await fetchAddonMeta(transportUrl, item.type, item.id);
            const video = meta ? firstPlayableVideo(meta) : null;
            if (video) videoId = video.id;
          } catch {
            // mantém o palpite abaixo
          }
        }
        if (videoId === item.id && item.id.startsWith('tt')) {
          videoId = `${item.id}:1:1`;
        }
      }

      return {
        type: item.type,
        id: item.id,
        videoId,
        title: item.name,
        catalogsTested
      };
    } catch {
      // tenta o próximo catálogo
    }
  }

  const rows = listStremioLibraryRows(80);
  const row = rows.find(
    (entry) =>
      supportsResource(manifest, 'stream', entry.type, entry.meta_id) ||
      supportsResource(manifest, 'meta', entry.type, entry.meta_id)
  );
  if (!row) return null;

  return {
    type: row.type,
    id: row.meta_id,
    videoId: row.video_id ?? row.meta_id,
    title: row.name,
    catalogsTested
  };
}

async function testStreams(
  transportUrl: string,
  manifest: AddonManifest,
  sample: Sample
): Promise<AddonStreamSummaryDto> {
  const summary: AddonStreamSummaryDto = {
    sampleTitle: sample.title,
    sampleId: sample.id,
    sampleType: sample.type,
    count: 0,
    kinds: { direct: 0, torrent: 0, external: 0, unknown: 0 },
    qualities: [],
    maxSeeds: null,
    totalBytes: null,
    largestBytes: null,
    elapsedMs: 0,
    error: null
  };

  if (!supportsResource(manifest, 'stream', sample.type, sample.videoId)) {
    summary.error = 'O addon não declara streams para este tipo/ID.';
    return summary;
  }

  const started = Date.now();
  try {
    const result = await fetchAddonStreams(transportUrl, sample.type, sample.videoId);
    summary.elapsedMs = result.elapsedMs;
    summary.count = result.streams.length;
    const qualities = new Set<string>();
    let totalBytes = 0;
    for (const stream of result.streams) {
      summary.kinds[stream.kind]++;
      if (stream.quality) qualities.add(stream.quality);
      if (stream.sizeBytes !== null) {
        totalBytes += stream.sizeBytes;
        summary.largestBytes = Math.max(summary.largestBytes ?? 0, stream.sizeBytes);
      }
      if (stream.seeds !== null) {
        summary.maxSeeds = Math.max(summary.maxSeeds ?? 0, stream.seeds);
      }
    }
    summary.qualities = [...qualities].sort();
    summary.totalBytes = totalBytes > 0 ? totalBytes : null;
  } catch (error) {
    summary.elapsedMs = Date.now() - started;
    summary.error = error instanceof Error ? error.message : 'Falha ao consultar streams.';
  }

  return summary;
}

export async function testAddon(id: string): Promise<AddonTestSummaryDto> {
  const row = requireAddon(id);
  const summary: AddonTestSummaryDto = {
    ok: false,
    elapsedMs: 0,
    manifestMs: 0,
    catalogsDeclared: 0,
    catalogsTested: 0,
    streams: null,
    warnings: []
  };
  const started = Date.now();

  let transportUrl: string;
  try {
    transportUrl = getAddonTransportUrl(row);
  } catch {
    summary.warnings.push('Não foi possível descriptografar a URL do addon. Reconecte/recadastre.');
    summary.elapsedMs = Date.now() - started;
    setAddonTestState(id, { ok: false, error: summary.warnings[0]!, summary });
    return summary;
  }

  let manifest: AddonManifest;
  try {
    const loaded = await loadAddonManifest(transportUrl);
    manifest = loaded.manifest;
    summary.manifestMs = loaded.elapsedMs;
    summary.catalogsDeclared = manifest.catalogs?.length ?? 0;
  } catch (error) {
    summary.warnings.push(
      error instanceof Error ? error.message : 'Não foi possível carregar o manifest do addon.'
    );
    summary.elapsedMs = Date.now() - started;
    setAddonTestState(id, { ok: false, error: summary.warnings[0]!, summary });
    return summary;
  }

  const streamCapability = resourceCapability(manifest, 'stream');
  let sample: Sample | null = null;
  try {
    sample = await pickSample(transportUrl, manifest);
    summary.catalogsTested = sample?.catalogsTested ?? 0;
    if (!sample) {
      summary.warnings.push('Não encontrei um título de exemplo (nem catálogo, nem biblioteca).');
    }
  } catch (error) {
    summary.warnings.push(error instanceof Error ? error.message : 'Falha ao consultar catálogos.');
  }

  if (streamCapability) {
    if (sample) {
      summary.streams = await testStreams(transportUrl, manifest, sample);
      if (summary.streams.error) {
        summary.warnings.push(summary.streams.error);
      } else if (summary.streams.count === 0) {
        summary.warnings.push('O addon respondeu, mas não retornou streams para o exemplo.');
      }
    }
    summary.ok = !summary.streams?.error;
  } else {
    summary.warnings.push('Este addon não declara o recurso "stream".');
    summary.ok = sample !== null || summary.catalogsDeclared === 0;
  }

  summary.elapsedMs = Date.now() - started;
  setAddonTestState(id, {
    ok: summary.ok,
    error: summary.ok ? null : (summary.warnings[0] ?? 'Falha no teste'),
    summary
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Catálogos / exploração
// ---------------------------------------------------------------------------

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const KITSU_BASE = 'https://anime-kitsu.strem.fun';
const BUILTIN_KITSU_ADDON_ID = 'builtin-kitsu';
const BUILTIN_KITSU_CATALOGS: AddonCatalogDto[] = [
  {
    type: 'anime',
    id: 'kitsu-anime-trending',
    name: 'Kitsu Trending',
    extraSupported: [],
    extraRequired: [],
    canSearch: false
  },
  {
    type: 'anime',
    id: 'kitsu-anime-popular',
    name: 'Kitsu Most Popular',
    extraSupported: ['genre', 'skip'],
    extraRequired: [],
    canSearch: false
  },
  {
    type: 'anime',
    id: 'kitsu-anime-rating',
    name: 'Kitsu Highest Rated',
    extraSupported: ['genre', 'skip'],
    extraRequired: [],
    canSearch: false
  },
  {
    type: 'anime',
    id: 'kitsu-anime-list',
    name: 'Kitsu',
    extraSupported: ['search', 'skip'],
    extraRequired: ['search'],
    canSearch: true
  }
];

const KITSU_TRANSPORT = `${KITSU_BASE}/manifest.json`;
const KITSU_SEED_FLAG = 'kitsu-addon-seeded';

const KITSU_MANIFEST: AddonManifest = {
  id: 'community.anime.kitsu',
  name: 'Kitsu',
  description: 'Catálogos públicos de anime do Kitsu.',
  version: '1.0.0',
  resources: ['catalog', 'meta'],
  types: ['anime'],
  idPrefixes: ['kitsu:'],
  catalogs: BUILTIN_KITSU_CATALOGS.map((catalog) => ({
    type: catalog.type,
    id: catalog.id,
    name: catalog.name,
    extraSupported: catalog.extraSupported,
    extraRequired: catalog.extraRequired
  }))
};

/**
 * Registra o Kitsu como addon de verdade no primeiro boot, para que ele
 * apareça em Config → Addons e possa ser desativado/removido pelo usuário.
 * O arquivo marcador evita recriá-lo depois que o usuário o remover.
 */
export function ensureBuiltinKitsuAddon(): void {
  try {
    const marker = join(dirname(env.dbPath), KITSU_SEED_FLAG);
    if (existsSync(marker)) return;

    const alreadyRegistered =
      findAddonByUrl(KITSU_TRANSPORT) ||
      listAddonRows().some((row) => row.name.trim().toLowerCase() === 'kitsu');
    if (!alreadyRegistered) {
      createAddonRow({
        transportUrl: KITSU_TRANSPORT,
        manifest: KITSU_MANIFEST,
        priority: 1000
      });
    }
    writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch (error) {
    console.error(
      '[stremio-addons] não foi possível registrar o Kitsu embutido:',
      error instanceof Error ? error.message : error
    );
  }
}

export function listCatalogGroups(): AddonCatalogGroupDto[] {
  const groups: AddonCatalogGroupDto[] = [];
  for (const addon of getEnabledAddons()) {
    const catalogCapability = resourceCapability(addon.manifest, 'catalog');
    if (!catalogCapability) continue;
    for (const catalog of manifestCatalogs(addon.manifest)) {
      if (!catalogCapability.types.includes(catalog.type)) continue;
      groups.push({
        addonId: addon.id,
        addonName: addon.name,
        type: catalog.type,
        catalogId: catalog.id,
        name: catalog.name,
        canSearch: catalog.canSearch,
        extraSupported: catalog.extraSupported,
        extraRequired: catalog.extraRequired,
        priority: addon.priority
      });
    }
  }

  return groups.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.addonName.localeCompare(b.addonName) ||
      a.name.localeCompare(b.name)
  );
}

function findCatalog(manifest: AddonManifest, type: string, catalogId: string) {
  return manifestCatalogs(manifest).find(
    (catalog) => catalog.id === catalogId && catalog.type === type
  );
}

export async function getCatalogPage(input: {
  addonId: string;
  type: string;
  catalogId: string;
  search?: string;
  skip?: number;
  genre?: string;
}): Promise<AddonCatalogPageDto> {
  if (input.addonId === BUILTIN_KITSU_ADDON_ID) {
    const catalog = BUILTIN_KITSU_CATALOGS.find(
      (entry) => entry.type === input.type && entry.id === input.catalogId
    );
    if (!catalog) throw new ConnectorError('not_found', 'Catálogo não encontrado no Kitsu.');
    const search = input.search?.trim();
    if (search && !catalog.canSearch) {
      throw new ConnectorError('config', 'Este catálogo não suporta busca.');
    }
    if (input.genre && !catalog.extraSupported.includes('genre')) {
      throw new ConnectorError('config', 'Este catálogo não suporta filtro por gênero.');
    }

    const skip = Math.max(0, Math.floor(input.skip ?? 0));
    const extra: Record<string, string | number | undefined> = {};
    if (search) extra.search = search;
    if (
      (skip > 0 || catalog.extraRequired.includes('skip')) &&
      catalog.extraSupported.includes('skip')
    ) {
      extra.skip = skip;
    }
    if (input.genre && catalog.extraSupported.includes('genre')) extra.genre = input.genre;

    const result = await fetchAddonCatalog(KITSU_BASE, catalog, extra);
    const nextSkip =
      catalog.extraSupported.includes('skip') && result.items.length >= 10
        ? skip + 40
        : null;
    return {
      items: result.items.map((item) =>
        toCatalogItemDto(item, BUILTIN_KITSU_ADDON_ID, 'Kitsu')
      ),
      nextSkip,
      elapsedMs: result.elapsedMs
    };
  }

  const row = requireAddon(input.addonId);
  if (row.enabled !== 1) throw new ConnectorError('config', 'Este addon está desativado.');
  const manifest = getAddonManifest(row);
  const catalog = findCatalog(manifest, input.type, input.catalogId);
  if (!catalog) throw new ConnectorError('not_found', 'Catálogo não encontrado neste addon.');

  const search = input.search?.trim();
  if (search && !catalog.canSearch) {
    throw new ConnectorError('config', 'Este catálogo não suporta busca.');
  }
  if (input.genre && !catalog.extraSupported.includes('genre')) {
    throw new ConnectorError('config', 'Este catálogo não suporta filtro por gênero.');
  }

  const requestedSkip = Math.max(0, Math.floor(input.skip ?? 0));
  const skipSupported = catalog.extraSupported.includes('skip');
  const buildExtra = (pageSkip: number): Record<string, string | number | undefined> => {
    const extra: Record<string, string | number | undefined> = {};
    if (search) extra.search = search;
    if ((pageSkip > 0 || catalog.extraRequired.includes('skip')) && skipSupported) {
      extra.skip = pageSkip;
    }
    if (input.genre && catalog.extraSupported.includes('genre')) extra.genre = input.genre;
    return extra;
  };

  const transportUrl = getAddonTransportUrl(row);
  let effectiveSkip = requestedSkip;
  let result = await fetchAddonCatalog(transportUrl, catalog, buildExtra(effectiveSkip));

  // Alguns addons têm buracos na paginação (ex.: skip=60 vazio, skip=80 cheio).
  // Avança em blocos de 20 quando a página vier vazia.
  let probes = 0;
  while (result.items.length === 0 && skipSupported && probes < 3) {
    effectiveSkip += 20;
    probes += 1;
    try {
      result = await fetchAddonCatalog(transportUrl, catalog, buildExtra(effectiveSkip));
    } catch {
      break;
    }
  }

  const nextSkip =
    skipSupported && result.items.length > 0 ? effectiveSkip + result.items.length : null;

  return {
    items: result.items.map((item) => toCatalogItemDto(item, row.id, row.name)),
    nextSkip,
    elapsedMs: result.elapsedMs
  };
}

// ---------------------------------------------------------------------------
// Busca global (todos os addons + Cinemeta/Kitsu)
// ---------------------------------------------------------------------------

const SEARCH_TIMEOUT_MS = 4_000;
const SEARCH_CACHE_TTL = 5 * 60_000;
const SEARCH_CACHE_MAX = 200;
const SEARCH_MAX_RESULTS = 120;
const SEARCH_FALLBACK_RESULTS = 12;

const SEARCH_STOP_WORDS = new Set([
  'a',
  'o',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'um',
  'uma',
  'sem',
  'com',
  'the',
  'of',
  'and'
]);

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleSearchScore(name: string, query: string): number {
  const title = normalizeSearchText(name);
  const needle = normalizeSearchText(query);
  if (!title || !needle) return 0;
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 90;
  if (title.includes(needle)) return 80;

  const queryTokens = needle
    .split(' ')
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));
  if (queryTokens.length === 0) return 0;
  const titleTokens = new Set(title.split(' '));
  const hits = queryTokens.filter((token) => titleTokens.has(token)).length;
  if (hits === queryTokens.length) return 70;
  if (hits > 0) return 40 + Math.round((hits / queryTokens.length) * 20);
  return 0;
}

interface SearchSourceResult {
  addonName: string;
  items: AddonCatalogItemDto[];
  error: string | null;
}

interface SearchCacheEntry {
  expiresAt: number;
  result: AddonSearchResultDto;
}

const searchCache = new Map<string, SearchCacheEntry>();

function withSearchTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Tempo esgotado')), SEARCH_TIMEOUT_MS);
    })
  ]);
}

function builtInSearchCatalog(type: string, id: string, name: string): AddonCatalogDto {
  return {
    type,
    id,
    name,
    extraSupported: ['search', 'skip'],
    extraRequired: [],
    canSearch: true
  };
}

async function searchBuiltIn(
  base: string,
  addonId: string,
  addonName: string,
  type: string,
  catalogId: string,
  query: string
): Promise<AddonCatalogItemDto[]> {
  const result = await fetchAddonCatalog(base, builtInSearchCatalog(type, catalogId, addonName), {
    search: query
  });
  return result.items.map((item) => toCatalogItemDto(item, addonId, addonName));
}

function uniqueSearchErrors(
  errors: AddonSearchResultDto['errors']
): AddonSearchResultDto['errors'] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.addonName}:${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Busca o termo nos catálogos de busca dos addons e em Cinemeta/Kitsu. */
export async function searchAllAddons(input: {
  query: string;
  type?: string;
}): Promise<AddonSearchResultDto> {
  const query = input.query.trim();
  if (query.length < 2) return { items: [], errors: [] };
  const type = input.type?.trim() || undefined;
  const cacheKey = `${type ?? 'all'}:${query.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const errors: AddonSearchResultDto['errors'] = [];
  const allGroups = listCatalogGroups();
  const configuredNames = new Set(allGroups.map((group) => group.addonName.toLowerCase()));
  const searchGroups: AddonCatalogGroupDto[] = [];
  const seenGroups = new Set<string>();
  for (const group of allGroups) {
    if (!group.canSearch || (type && group.type !== type)) continue;
    // Um catálogo de busca por addon/tipo evita consultas duplicadas
    // (ex.: FenixFlix declara dois catálogos pesquisáveis por tipo).
    const key = `${group.addonId}:${group.type}`;
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    searchGroups.push(group);
  }

  const configuredPromise = mapWithLimit(searchGroups, 4, async (group): Promise<SearchSourceResult> => {
    try {
      const page = await withSearchTimeout(
        getCatalogPage({
          addonId: group.addonId,
          type: group.type,
          catalogId: group.catalogId,
          search: query
        })
      );
      return { addonName: group.addonName, items: page.items, error: null };
    } catch (error) {
      return {
        addonName: group.addonName,
        items: [],
        error: error instanceof Error ? error.message : 'Falha ao buscar neste addon.'
      };
    }
  });

  const builtInTasks: Array<Promise<SearchSourceResult>> = [];
  if ((!type || type === 'movie') && !configuredNames.has('cinemeta')) {
    builtInTasks.push(
      withSearchTimeout(searchBuiltIn(CINEMETA_BASE, 'cinemeta', 'Cinemeta', 'movie', 'top', query))
        .then((items) => ({ addonName: 'Cinemeta', items, error: null }))
        .catch((error) => ({
          addonName: 'Cinemeta',
          items: [],
          error: error instanceof Error ? error.message : 'Falha na busca.'
        }))
    );
  }
  if ((!type || type === 'series') && !configuredNames.has('cinemeta')) {
    builtInTasks.push(
      withSearchTimeout(searchBuiltIn(CINEMETA_BASE, 'cinemeta', 'Cinemeta', 'series', 'top', query))
        .then((items) => ({ addonName: 'Cinemeta', items, error: null }))
        .catch((error) => ({
          addonName: 'Cinemeta',
          items: [],
          error: error instanceof Error ? error.message : 'Falha na busca.'
        }))
    );
  }
  if ((!type || type === 'anime') && !configuredNames.has('kitsu')) {
    builtInTasks.push(
      withSearchTimeout(
        searchBuiltIn(KITSU_BASE, 'kitsu', 'Kitsu', 'anime', 'kitsu-anime-list', query)
      )
        .then((items) => ({ addonName: 'Kitsu', items, error: null }))
        .catch((error) => ({
          addonName: 'Kitsu',
          items: [],
          error: error instanceof Error ? error.message : 'Falha na busca.'
        }))
    );
  }
  const [configured, builtIn] = await Promise.all([
    configuredPromise,
    Promise.all(builtInTasks)
  ]);

  const merged = new Map<string, AddonCatalogItemDto>();
  for (const source of [...configured, ...builtIn]) {
    if (source.error) errors.push({ addonName: source.addonName, message: source.error });
    for (const item of source.items) {
      const key = `${item.type}:${item.id}`;
      const existing = merged.get(key);
      if (existing) {
        existing.poster = existing.poster ?? item.poster;
        existing.year = existing.year ?? item.year;
        existing.imdbRating = existing.imdbRating ?? item.imdbRating;
        existing.description = existing.description ?? item.description;
      } else {
        merged.set(key, { ...item });
      }
    }
  }

  const scored = [...merged.values()]
    .map((item) => ({ item, score: titleSearchScore(item.name, query) }))
    .sort((a, b) => b.score - a.score);

  const hasExact = scored.some((entry) => entry.score === 100);
  const hasStarts = scored.some((entry) => entry.score === 90);
  const hasIncludes = scored.some((entry) => entry.score === 80);
  const hasTokens = scored.some((entry) => entry.score >= 70);

  let threshold = 0;
  if (hasExact) threshold = 90;
  else if (hasStarts) threshold = query.length <= 5 ? 90 : 80;
  else if (hasIncludes) threshold = 80;
  else if (hasTokens) threshold = 70;

  const relevant =
    threshold > 0
      ? scored.filter((entry) => entry.score >= threshold)
      : scored.slice(0, SEARCH_FALLBACK_RESULTS);

  const result: AddonSearchResultDto = {
    items: relevant.map((entry) => entry.item).slice(0, SEARCH_MAX_RESULTS),
    errors: uniqueSearchErrors(errors),
    approximate: threshold === 0
  };

  if (result.items.length > 0) {
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = [...searchCache.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt
      )[0];
      if (oldest) searchCache.delete(oldest[0]);
    }
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL, result });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Metadados agregados (usado pela tela de detalhes)
// ---------------------------------------------------------------------------

export async function getAddonMetaForTitle(
  type: string,
  id: string,
  preferredAddonId?: string | null
): Promise<{ meta: NormalizedMeta; addonId: string; addonName: string } | null> {
  const addons = getEnabledAddons().filter((addon) =>
    supportsResource(addon.manifest, 'meta', type, id)
  );
  if (preferredAddonId) {
    addons.sort((a, b) => (a.id === preferredAddonId ? -1 : b.id === preferredAddonId ? 1 : 0));
  }

  for (const addon of addons.slice(0, 3)) {
    try {
      const meta = await fetchAddonMeta(addon.transportUrl, type, id);
      if (meta) {
        return { meta, addonId: addon.id, addonName: addon.name };
      }
    } catch {
      // tenta o próximo addon
    }
  }
  return null;
}

export function hasStreamAddonsFor(type: string, id: string): boolean {
  return getEnabledAddons().some((addon) => supportsResource(addon.manifest, 'stream', type, id));
}

// ---------------------------------------------------------------------------
// Metadados leves dos cards (nota IMDb, sinopse e trailer)
// ---------------------------------------------------------------------------

const CARD_INFO_TTL = 6 * 60 * 60_000;
const CARD_INFO_ERROR_TTL = 5 * 60_000;
const CARD_INFO_TIMEOUT_MS = 8_000;
const CARD_INFO_MAX_ITEMS = 30;

interface CardInfoCacheEntry {
  expiresAt: number;
  info: StremioCardInfoDto;
}

const cardInfoCache = new Map<string, CardInfoCacheEntry>();
const cardInfoJobs = new Map<string, Promise<StremioCardInfoDto>>();

function isAnimeMetaId(id: string): boolean {
  return /^(kitsu|anilist|mal|myanimelist|anidb):/i.test(id);
}

/**
 * Fallback público quando nenhum addon configurado devolve metadados
 * (ex.: usuário sem Cinemeta/Kitsu instalado). Só consulta IDs compatíveis.
 */
async function getFallbackMeta(type: string, id: string): Promise<NormalizedMeta | null> {
  const candidates: Array<{ base: string; type: string }> = [];
  if (/^tt\d{7,10}$/i.test(id)) {
    if (type === 'movie' || type === 'series') candidates.push({ base: CINEMETA_BASE, type });
  }
  if (isAnimeMetaId(id)) {
    candidates.push({ base: KITSU_BASE, type: 'anime' });
    if (type !== 'anime') candidates.push({ base: KITSU_BASE, type });
  }

  for (const candidate of candidates) {
    try {
      const meta = await fetchAddonMeta(candidate.base, candidate.type, id);
      if (meta) return meta;
    } catch {
      // tenta o próximo fallback
    }
  }
  return null;
}

function emptyCardInfo(type: string, id: string): StremioCardInfoDto {
  return {
    type,
    id,
    imdbRating: null,
    overview: null,
    trailerYtId: null,
    backdropUrl: null,
    isAnime: false
  };
}

async function loadCardInfo(
  type: string,
  id: string,
  nameHint?: string | null
): Promise<StremioCardInfoDto> {
  const key = `${type}:${id}`;
  const cached = cardInfoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  const running = cardInfoJobs.get(key);
  if (running) return running;

  const job = (async () => {
    let info = emptyCardInfo(type, id);
    let found = false;
    let metaName: string | null = null;
    let metaGenres: string[] = [];
    let tmdbGenres: string[] = [];
    let tmdbLanguage: string | null = null;
    let tmdbOrigin: string[] = [];
    try {
      const result = await Promise.race([
        getAddonMetaForTitle(type, id),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), CARD_INFO_TIMEOUT_MS);
        })
      ]);
      const meta = result?.meta ?? (await getFallbackMeta(type, id).catch(() => null));
      if (meta) {
        found = true;
        metaName = meta.name;
        metaGenres = meta.genres;
        info = {
          type,
          id,
          imdbRating: meta.imdbRating,
          overview: meta.description,
          trailerYtId: meta.trailerYtId,
          backdropUrl: meta.background,
          isAnime: isAnimeMetaId(id)
        };
      }

      // Completa o que faltar com o TMDB (inclusive trailer em inglês,
      // já que muitos títulos não têm trailer em português).
      const animationFromMeta = metaGenres.some((genre) => /anima/i.test(genre));
      if (!info.overview || !info.backdropUrl || !info.trailerYtId || animationFromMeta) {
        try {
          const tmdb = await fetchTitleDetails(
            id,
            type === 'movie' ? 'movie' : 'series',
            nameHint ?? metaName ?? null,
            { withTrailer: !info.trailerYtId }
          );
          found = true;
          metaName = metaName ?? tmdb.name;
          metaGenres = metaGenres.length > 0 ? metaGenres : tmdb.genres;
          tmdbGenres = tmdb.genres;
          tmdbLanguage = tmdb.originalLanguage;
          tmdbOrigin = tmdb.originCountry;
          info.overview = info.overview ?? tmdb.overview;
          info.backdropUrl = info.backdropUrl ?? tmdb.backdropUrl;
          info.trailerYtId = info.trailerYtId ?? tmdb.trailerYtId;
        } catch {
          // TMDB indisponível ou título não encontrado: segue com o addon
        }
      }

      const isAnimation =
        animationFromMeta || tmdbGenres.some((genre) => /anima/i.test(genre));
      const japaneseOrigin =
        tmdbLanguage === 'ja' ||
        tmdbOrigin.some((country) => country.toUpperCase() === 'JP');
      info.isAnime =
        isAnimeMetaId(id) ||
        (isAnimation && (tmdbLanguage || tmdbOrigin.length > 0 ? japaneseOrigin : true));

      // Último recurso para trailer de animação: o AniList costuma ter.
      if (!info.trailerYtId && info.isAnime) {
        const title = nameHint ?? metaName;
        if (title) {
          info.trailerYtId = await fetchAniListTrailer(title);
        }
      }
    } catch {
      // mantém os campos vazios; o card continua funcional
    }
    cardInfoCache.set(key, {
      expiresAt: Date.now() + (found ? CARD_INFO_TTL : CARD_INFO_ERROR_TTL),
      info
    });
    return info;
  })().finally(() => {
    cardInfoJobs.delete(key);
  });

  cardInfoJobs.set(key, job);
  return job;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Busca nota/sinopse/trailer para os cards visíveis, com cache em memória. */
export async function getCardInfoForTitles(
  items: Array<{ type: string; id: string; name?: string | null }>
): Promise<StremioCardInfoDto[]> {
  const unique = new Map<string, { type: string; id: string; name?: string | null }>();
  for (const item of items.slice(0, CARD_INFO_MAX_ITEMS)) {
    const key = `${item.type}:${item.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return mapWithLimit([...unique.values()], 10, (item) =>
    loadCardInfo(item.type, item.id, item.name)
  );
}

// ---------------------------------------------------------------------------
// Streams para o player do Feed
// ---------------------------------------------------------------------------

const DEFAULT_TRACKERS = [
  'tracker:udp://tracker.opentrackr.org:1337/announce',
  'tracker:udp://open.stealth.si:80/announce',
  'tracker:udp://tracker.torrent.eu.org:451/announce',
  'tracker:udp://exodus.desync.com:6969/announce',
  'tracker:https://tracker.tamersunion.org:443/announce'
];

const STREAM_FRESH_TTL = 15 * 60_000;
const STREAM_ERROR_TTL = 20_000;
const STREAM_CACHE_MAX_ROWS = 600;

function streamStaleTtlMs(): number {
  try {
    return Math.max(1, getSettings().streamCacheTtlHours) * 60 * 60_000;
  } catch {
    return 24 * 60 * 60_000;
  }
}

interface StreamErrorEntry {
  expiresAt: number;
  error: string;
  helpUrl: string | null;
}

const log = createLogger('addons-cache');
const streamErrors = new Map<string, StreamErrorEntry>();
const streamRefreshJobs = new Map<string, Promise<void>>();
let streamCacheCleanupDone = false;

function addonCacheKey(addon: EnabledAddon): string {
  return createHash('sha256').update(addon.transportUrl).digest('hex').slice(0, 16);
}

function streamCacheKey(addonKey: string, type: string, videoId: string): string {
  return `${addonKey}:${type}:${videoId}`;
}

function cleanupStreamCacheOnce(): void {
  if (streamCacheCleanupDone) return;
  streamCacheCleanupDone = true;
  try {
    deleteOldStreamCache(new Date(Date.now() - streamStaleTtlMs()).toISOString());
    pruneStreamCache(STREAM_CACHE_MAX_ROWS);
  } catch (error) {
    log.warn(`falha ao limpar cache de streams: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readStreamCache(
  addonKey: string,
  type: string,
  videoId: string
): { streams: NormalizedStream[]; ageMs: number } | null {
  cleanupStreamCacheOnce();
  const row = getStreamCacheRow(addonKey, type, videoId);
  if (!row) return null;
  const cachedAt = Date.parse(row.cached_at);
  if (!Number.isFinite(cachedAt)) return null;
  const ageMs = Math.max(0, Date.now() - cachedAt);
  if (ageMs > streamStaleTtlMs()) return null;
  try {
    const parsed = JSON.parse(row.streams_json) as unknown;
    if (!Array.isArray(parsed)) return null;
    return { streams: parsed as NormalizedStream[], ageMs };
  } catch {
    return null;
  }
}

function writeStreamCache(
  addonKey: string,
  type: string,
  videoId: string,
  streams: NormalizedStream[]
): void {
  const now = Date.now();
  try {
    saveStreamCacheRow({
      addonKey,
      type,
      videoId,
      streamsJson: JSON.stringify(streams),
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + STREAM_FRESH_TTL).toISOString()
    });
  } catch (error) {
    log.warn(`falha ao salvar cache de streams: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchAndStoreStreams(
  addon: EnabledAddon,
  type: string,
  videoId: string,
  addonKey: string
): Promise<NormalizedStream[]> {
  const response = await fetchAddonStreams(addon.transportUrl, type, videoId);
  writeStreamCache(addonKey, type, videoId, response.streams);
  streamErrors.delete(streamCacheKey(addonKey, type, videoId));
  return response.streams;
}

function scheduleStreamRefresh(
  addon: EnabledAddon,
  type: string,
  videoId: string,
  addonKey: string
): boolean {
  const key = streamCacheKey(addonKey, type, videoId);
  if (streamRefreshJobs.has(key)) return true;

  const job = fetchAndStoreStreams(addon, type, videoId, addonKey)
    .then(() => undefined)
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Falha ao consultar streams.';
      const helpUrl = error instanceof AddonHttpError ? error.helpUrl : null;
      streamErrors.set(key, { expiresAt: Date.now() + STREAM_ERROR_TTL, error: message, helpUrl });
      log.warn(`${addon.name}: falha ao atualizar streams em segundo plano: ${message}`);
    })
    .finally(() => {
      streamRefreshJobs.delete(key);
    });

  streamRefreshJobs.set(key, job);
  return true;
}

async function fetchStreamsCached(
  addon: EnabledAddon,
  type: string,
  videoId: string,
  refresh = false
) {
  const addonKey = addonCacheKey(addon);
  const key = streamCacheKey(addonKey, type, videoId);

  if (!refresh) {
    const cached = readStreamCache(addonKey, type, videoId);
    if (cached) {
      if (cached.ageMs <= STREAM_FRESH_TTL) {
        return {
          addon,
          streams: cached.streams,
          error: undefined,
          helpUrl: undefined,
          cached: true,
          refreshing: false
        };
      }

      const recentError = streamErrors.get(key);
      if (recentError && recentError.expiresAt > Date.now()) {
        return {
          addon,
          streams: cached.streams,
          error: undefined,
          helpUrl: undefined,
          cached: true,
          refreshing: false
        };
      }

      const refreshing = scheduleStreamRefresh(addon, type, videoId, addonKey);
      return {
        addon,
        streams: cached.streams,
        error: undefined,
        helpUrl: undefined,
        cached: true,
        refreshing
      };
    }

    const cachedError = streamErrors.get(key);
    if (cachedError && cachedError.expiresAt > Date.now()) {
      return {
        addon,
        streams: undefined,
        error: cachedError.error,
        helpUrl: cachedError.helpUrl,
        cached: false,
        refreshing: false
      };
    }
  }

  try {
    const streams = await fetchAndStoreStreams(addon, type, videoId, addonKey);
    return {
      addon,
      streams,
      error: undefined,
      helpUrl: undefined,
      cached: false,
      refreshing: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar streams.';
    const helpUrl = error instanceof AddonHttpError ? error.helpUrl : null;
    streamErrors.set(key, { expiresAt: Date.now() + STREAM_ERROR_TTL, error: message, helpUrl });
    return {
      addon,
      streams: undefined,
      error: message,
      helpUrl,
      cached: false,
      refreshing: false
    };
  }
}

function qualityRank(quality: string | null): number {
  if (!quality) return 0;
  const match = /(\d{3,4})p/i.exec(quality);
  if (!match) return 0;
  const value = Number(match[1]);
  if (value >= 2160) return 6;
  if (value >= 1440) return 5;
  if (value >= 1080) return 4;
  if (value >= 720) return 3;
  if (value >= 480) return 2;
  if (value >= 360) return 1;
  return 0;
}

function kindRank(kind: TitleStreamKind): number {
  if (kind === 'direct') return 0;
  if (kind === 'torrent') return 1;
  if (kind === 'external') return 2;
  return 3;
}

function torrentPlaybackUrl(stream: NormalizedStream): string | null {
  if (!stream.infoHash) return null;
  const base = getStremioServerUrl();
  const sources = [...stream.sources];
  if (!sources.some((source) => /^tracker:/i.test(source))) {
    sources.push(...DEFAULT_TRACKERS);
  }
  sources.push(`dht:${stream.infoHash}`);
  const unique = [...new Set(sources)];
  const query = unique.map((source) => `tr=${encodeURIComponent(source)}`).join('&');
  const index = stream.fileIdx ?? -1;
  return `${base}/${stream.infoHash}/${index}${query ? `?${query}` : ''}`;
}

function toStreamDto(
  stream: NormalizedStream,
  addon: EnabledAddon,
  index: number
): TitleStreamDto {
  const kind = stream.kind as TitleStreamKind;
  const playbackUrl =
    kind === 'torrent'
      ? torrentPlaybackUrl(stream)
      : kind === 'direct'
        ? stream.url
        : kind === 'external'
          ? stream.externalUrl
          : null;

  return {
    id: `${addon.id}:${index}`,
    addonId: addon.id,
    addonName: addon.name,
    name: stream.name,
    title: stream.title,
    description: stream.description,
    kind,
    url: stream.url,
    playbackUrl,
    externalUrl: stream.externalUrl,
    ytId: stream.ytId,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    sources: stream.sources,
    quality: stream.quality,
    sizeBytes: stream.sizeBytes,
    seeds: stream.seeds,
    behaviorHints: stream.behaviorHints
  };
}

export async function getStreamsForTitle(input: {
  type: string;
  id: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
  refresh?: boolean;
}): Promise<TitleStreamsDto> {
  const started = Date.now();
  const id = input.id.trim();
  const type = input.type.trim();
  const videoId =
    input.videoId?.trim() ||
    (type !== 'movie' && input.season !== null && input.season !== undefined &&
    input.episode !== null && input.episode !== undefined
      ? `${id}:${input.season}:${input.episode}`
      : id);

  const addons = getEnabledAddons().filter((addon) =>
    supportsResource(addon.manifest, 'stream', type, videoId)
  );
  const errors: TitleStreamsDto['errors'] = [];
  const collected: Array<{ stream: TitleStreamDto; priority: number }> = [];

  const results = await Promise.all(
    addons.map((addon) =>
      fetchStreamsCached(addon, type, videoId, input.refresh === true)
    )
  );

  for (const result of results) {
    if (!result.streams) {
      errors.push({
        addonId: result.addon.id,
        addonName: result.addon.name,
        message: result.error ?? 'Falha ao consultar streams.',
        helpUrl: result.helpUrl ?? null
      });
      continue;
    }
    result.streams.forEach((stream, index) => {
      collected.push({
        stream: toStreamDto(stream, result.addon, index),
        priority: result.addon.priority
      });
    });
  }

  collected.sort(
    (a, b) =>
      kindRank(a.stream.kind) - kindRank(b.stream.kind) ||
      qualityRank(b.stream.quality) - qualityRank(a.stream.quality) ||
      (b.stream.seeds ?? 0) - (a.stream.seeds ?? 0) ||
      a.priority - b.priority
  );

  const seen = new Set<string>();
  const streams: TitleStreamDto[] = [];
  for (const entry of collected) {
    const stream = entry.stream;
    const key =
      stream.playbackUrl ??
      stream.externalUrl ??
      (stream.infoHash ? `${stream.infoHash}:${stream.fileIdx ?? -1}` : stream.url) ??
      stream.id;
    if (seen.has(key)) continue;
    seen.add(key);
    streams.push(stream);
  }

  const cacheUsed = results.some((result) => result.cached);
  const refreshing = results.some((result) => result.refreshing);

  return {
    type,
    id,
    videoId,
    streams,
    errors,
    cache: { used: cacheUsed, refreshing },
    elapsedMs: Date.now() - started
  };
}

// ---------------------------------------------------------------------------
// Legendas
// ---------------------------------------------------------------------------

interface SubtitleCacheEntry {
  expiresAt: number;
  subtitles?: TitleSubtitleDto[];
  error?: string;
}

const subtitleCache = new Map<string, SubtitleCacheEntry>();
const SUBTITLE_SUCCESS_TTL = 5 * 60_000;
const SUBTITLE_ERROR_TTL = 20_000;

async function fetchSubtitlesCached(addon: EnabledAddon, type: string, videoId: string) {
  const key = `${addon.id}:${type}:${videoId}`;
  const cached = subtitleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.subtitles) return { addon, subtitles: cached.subtitles, error: undefined };
    return { addon, subtitles: undefined, error: cached.error };
  }

  try {
    const response = await fetchAddonSubtitles(addon.transportUrl, type, videoId);
    const subtitles: TitleSubtitleDto[] = response.subtitles.map((subtitle, index) => ({
      id: subtitle.id ?? `${addon.id}:${index}`,
      addonId: addon.id,
      addonName: addon.name,
      lang: subtitle.lang,
      language: subtitleLanguageName(subtitle.lang),
      url: subtitle.url,
      proxyUrl: `/api/stremio/subtitle?url=${encodeURIComponent(subtitle.url)}`
    }));
    subtitleCache.set(key, { expiresAt: Date.now() + SUBTITLE_SUCCESS_TTL, subtitles });
    return { addon, subtitles, error: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar legendas.';
    subtitleCache.set(key, { expiresAt: Date.now() + SUBTITLE_ERROR_TTL, error: message });
    return { addon, subtitles: undefined, error: message };
  }
}

export async function getSubtitlesForTitle(input: {
  type: string;
  id: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
}): Promise<TitleSubtitlesDto> {
  const started = Date.now();
  const id = input.id.trim();
  const type = input.type.trim();
  const videoId =
    input.videoId?.trim() ||
    (type !== 'movie' &&
    input.season !== null &&
    input.season !== undefined &&
    input.episode !== null &&
    input.episode !== undefined
      ? `${id}:${input.season}:${input.episode}`
      : id);

  const addons = getEnabledAddons().filter((addon) =>
    supportsResource(addon.manifest, 'subtitles', type, videoId)
  );
  const errors: TitleSubtitlesDto['errors'] = [];
  const collected: Array<{ subtitle: TitleSubtitleDto; priority: number }> = [];

  const results = await Promise.all(
    addons.map((addon) => fetchSubtitlesCached(addon, type, videoId))
  );

  for (const result of results) {
    if (!result.subtitles) {
      errors.push({
        addonId: result.addon.id,
        addonName: result.addon.name,
        message: result.error ?? 'Falha ao consultar legendas.'
      });
      continue;
    }
    for (const subtitle of result.subtitles) {
      collected.push({ subtitle, priority: result.addon.priority });
    }
  }

  collected.sort(
    (a, b) =>
      subtitleLanguageRank(a.subtitle.lang) - subtitleLanguageRank(b.subtitle.lang) ||
      a.subtitle.language.localeCompare(b.subtitle.language, 'pt-BR') ||
      a.priority - b.priority
  );

  const seen = new Set<string>();
  const subtitles: TitleSubtitleDto[] = [];
  for (const entry of collected) {
    if (seen.has(entry.subtitle.url)) continue;
    seen.add(entry.subtitle.url);
    subtitles.push(entry.subtitle);
  }

  return {
    type,
    id,
    videoId,
    subtitles,
    errors,
    elapsedMs: Date.now() - started
  };
}

// ---------------------------------------------------------------------------
// Áudio / probe do Stremio Server
// ---------------------------------------------------------------------------

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOfValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildTranscodeUrl(baseUrl: string, mediaUrl: string): string {
  const id = randomUUID().replace(/-/g, '').slice(0, 20);
  const params = new URLSearchParams();
  params.set('mediaURL', mediaUrl);
  for (const codec of ['h264', 'vp8', 'vp9', 'av1']) params.append('videoCodecs', codec);
  for (const codec of ['aac', 'mp3', 'opus', 'vorbis', 'flac']) params.append('audioCodecs', codec);
  params.set('maxAudioChannels', '2');
  const master = `${baseUrl}/hlsv2/${id}/master.m3u8?${params.toString()}`;
  // O Stremio Server não manda CORS; o hls.js busca tudo pelo proxy local.
  return `/api/stremio/hls?url=${encodeURIComponent(master)}`;
}

/**
 * Consulta o ffprobe do Stremio Server para descobrir faixas de áudio.
 * Devolve também o master HLS de transcodificação: o player o usa quando há
 * 2+ faixas (troca de áudio) ou quando o formato direto não toca no navegador.
 */
export async function probeStreamForAudio(mediaUrl: string): Promise<StremioProbeDto> {
  const empty = (error: string | null, available: boolean): StremioProbeDto => ({
    available,
    audioTracks: [],
    videoCodec: null,
    container: null,
    hlsUrl: null,
    error
  });

  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    return empty('URL de mídia inválida.', false);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return empty('A mídia precisa usar http ou https.', false);
  }

  const status = await getStremioServerStatus();
  if (!status.available) {
    return empty('Stremio Server não está rodando.', false);
  }

  const probeUrl = `${status.baseUrl}/hlsv2/probe?mediaURL=${encodeURIComponent(mediaUrl)}`;
  try {
    const response = await fetch(probeUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/json', 'user-agent': 'Hub/0.4' }
    });
    if (!response.ok) {
      return empty(`O Stremio Server não conseguiu analisar a mídia (HTTP ${response.status}).`, true);
    }
    const data = (await response.json().catch(() => null)) as
      | { streams?: unknown; format?: { name?: unknown } }
      | null;
    const streams = Array.isArray(data?.streams)
      ? data.streams.filter(
          (stream): stream is Record<string, unknown> =>
            typeof stream === 'object' && stream !== null
        )
      : [];

    const audioTracks: StremioAudioTrackDto[] = [];
    let videoCodec: string | null = null;
    for (const stream of streams) {
      if (stream.track === 'video' && !videoCodec) {
        videoCodec = textOrNull(stream.codec);
        continue;
      }
      if (stream.track !== 'audio') continue;
      const tags =
        typeof stream.tags === 'object' && stream.tags !== null
          ? (stream.tags as Record<string, unknown>)
          : {};
      const language =
        textOrNull(tags.language) ??
        textOrNull(tags.language_ietf) ??
        textOrNull(stream.lang);
      audioTracks.push({
        index: audioTracks.length,
        language,
        languageLabel: language ? subtitleLanguageName(language) : null,
        title: textOrNull(tags.title) ?? textOrNull(stream.title),
        codec: textOrNull(stream.codec),
        channels: numberOfValue(stream.channels)
      });
    }

    return {
      available: true,
      audioTracks,
      videoCodec,
      container: textOrNull(data?.format?.name),
      hlsUrl: buildTranscodeUrl(status.baseUrl, mediaUrl),
      error: null
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return empty(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'A análise de áudio demorou demais.'
        : 'Não foi possível analisar as faixas de áudio.',
      true
    );
  }
}

