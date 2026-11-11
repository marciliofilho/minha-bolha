/**
 * Cliente da API de conta do Stremio (não oficial).
 * Endpoints usados: POST /api/login e POST /api/datastoreGet (somente leitura).
 * A senha nunca é persistida; o authKey só transita em memória e no corpo
 * das requisições (nunca em URLs/logs).
 */
import type { RawStremioLibraryItem } from '../../connectors/types';

const BASE = process.env.STREMIO_API_BASE ?? 'https://api.strem.io/api';
const TIMEOUT_MS = 20_000;

export class StremioApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'StremioApiError';
    this.status = status;
  }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new StremioApiError('Não foi possível falar com o Stremio. Verifique a conexão.', 502);
  }

  const text = await response.text();
  let payload: { result?: unknown; error?: { message?: string; code?: number } };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new StremioApiError('O Stremio devolveu uma resposta inesperada.', 502);
  }

  if (!response.ok || payload.error) {
    const rawMessage = payload.error?.message ?? `HTTP ${response.status}`;
    // login e datastoreGet só falham por credenciais/sessão na prática.
    const authFailure =
      path === 'login' ||
      path === 'datastoreGet' ||
      path === 'addonCollectionGet' ||
      response.status === 401 ||
      response.status === 403 ||
      /auth|credential|password|login|user|session|token|key|expired/i.test(rawMessage);
    throw new StremioApiError(
      authFailure ? 'E-mail, senha ou chave de sessão inválidos.' : 'O Stremio recusou a requisição.',
      authFailure ? 401 : 502
    );
  }

  return payload.result as T;
}

export async function stremioLogin(
  email: string,
  password: string
): Promise<{ authKey: string; email: string }> {
  const result = await post<{ authKey?: string; user?: { email?: string } }>('login', {
    email,
    password
  });

  if (!result?.authKey) {
    throw new StremioApiError('O Stremio não retornou uma chave de sessão.', 502);
  }
  return { authKey: result.authKey, email: result.user?.email ?? email };
}

interface RawStremioItem {
  _id?: string;
  name?: string;
  type?: string;
  poster?: string;
  _mtime?: string;
  removed?: boolean;
  temp?: boolean;
  state?: {
    timeOffset?: number;
    duration?: number;
    video_id?: string;
    lastWatched?: string;
    season?: number;
    episode?: number;
    watched?: string;
  } | null;
  [key: string]: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapItem(item: RawStremioItem): RawStremioLibraryItem | null {
  const rawId = typeof item._id === 'string' ? item._id.trim() : '';
  if (!rawId) return null;
  if (item.type !== 'movie' && item.type !== 'series') return null;

  // Filmes e séries normalmente usam IMDB, mas animes e catálogos externos
  // podem usar kitsu:..., tmdb:..., etc. O ID original é sempre preservado.
  const imdbCandidate = rawId.split(':')[0] ?? '';
  const imdbId = /^tt\d{7,10}$/i.test(imdbCandidate) ? imdbCandidate : null;

  const state = item.state ?? {};
  const videoId = typeof state.video_id === 'string' ? state.video_id : null;
  const parts = videoId?.split(':') ?? [];
  const seasonFromVideo = parts.length >= 3 ? Number(parts[1]) : null;
  const episodeFromVideo = parts.length >= 3 ? Number(parts[2]) : null;

  return {
    metaId: rawId,
    imdbId,
    type: item.type,
    name: typeof item.name === 'string' ? item.name : rawId,
    poster: typeof item.poster === 'string' ? item.poster : null,
    videoId,
    season: Number.isFinite(seasonFromVideo) ? seasonFromVideo : numberOrNull(state.season),
    episode: Number.isFinite(episodeFromVideo) ? episodeFromVideo : numberOrNull(state.episode),
    timeOffset: numberOrNull(state.timeOffset),
    duration: numberOrNull(state.duration),
    watchedVideoId: typeof state.watched === 'string' ? state.watched : null,
    lastWatchedAt:
      typeof state.lastWatched === 'string'
        ? state.lastWatched
        : typeof item._mtime === 'string'
          ? item._mtime
          : null,
    removed: item.removed === true,
    temp: item.temp === true,
    raw: item
  };
}

/** Lê a biblioteca da conta. Não escreve nada (somente leitura). */
export async function fetchStremioLibrary(authKey: string): Promise<RawStremioLibraryItem[]> {
  const result = await post<unknown>('datastoreGet', {
    authKey,
    collection: 'libraryItem',
    all: true
  });

  const entries = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { library?: unknown }).library)
      ? ((result as { library: unknown[] }).library as unknown[])
      : [];

  const items: RawStremioLibraryItem[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const mapped = mapItem(entry as RawStremioItem);
    if (mapped) items.push(mapped);
  }
  return items;
}

export interface RawStremioAddonDescriptor {
  transportUrl: string;
  transportName: string | null;
  manifest: unknown;
  flags?: unknown;
}

/**
 * Lê a coleção de addons da conta (somente leitura).
 * A API não é oficial; o formato atual devolve { result: { addons: [...] } }.
 */
export async function fetchStremioAddonCollection(
  authKey: string
): Promise<RawStremioAddonDescriptor[]> {
  const result = await post<unknown>('addonCollectionGet', { authKey, update: true });
  const entries = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { addons?: unknown[] }).addons)
      ? ((result as { addons: unknown[] }).addons as unknown[])
      : [];

  const addons: RawStremioAddonDescriptor[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const transportUrl = typeof value.transportUrl === 'string' ? value.transportUrl : '';
    if (!transportUrl) continue;
    addons.push({
      transportUrl,
      transportName: typeof value.transportName === 'string' ? value.transportName : null,
      manifest: value.manifest,
      flags: value.flags
    });
  }
  return addons;
}
