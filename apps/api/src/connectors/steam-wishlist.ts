/**
 * Conector da wishlist da Steam.
 *
 * - Aceita SteamID64, link de perfil (/profiles/…) ou vanity (/id/…).
 * - Usa IWishlistService/GetWishlist/v1 (sem API key).
 * - Metadados e preço base vêm de appdetails, com cache de 7 dias.
 */
import type { GameSearchResultDto, ResolvedSourceDto, SettingsDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawWishlistGame } from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { decodeEntities, stripHtml } from './util';
import { getGamesByAppids, type SteamAppMeta } from '../db/repositories/games';
import { formatMoney } from '../lib/money';
import { nowIso } from '../lib/dates';
import { secretValue } from '../lib/secrets';

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A API appdetails passou a rejeitar lotes com mais de 1 appid (HTTP 400).
// Buscamos um por um, com um pequeno intervalo para não estourar o rate limit.
const APP_BATCH_SIZE = 1;
const APP_BATCH_DELAY_MS = 300;

interface WishlistItem {
  appid: number;
  priority?: number;
  date_added?: number;
}

interface AppDetailsEntry {
  success?: boolean;
  data?: {
    name?: string;
    header_image?: string;
    capsule_image?: string;
    is_free?: boolean;
    price_overview?: {
      currency?: string;
      initial?: number;
      final?: number;
      discount_percent?: number;
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSteamId64(value: string): boolean {
  return /^\d{17}$/.test(value);
}

function regionCode(settings: SettingsDto): string {
  return settings.region.toLowerCase();
}

// ---------------------------------------------------------------------------
// Resolução do perfil
// ---------------------------------------------------------------------------

async function resolveVanity(vanity: string): Promise<string> {
  try {
    const response = await fetchText(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`, {
      accept: 'text/xml,application/xml'
    });
    const id = /<steamID64>(\d{17})<\/steamID64>/.exec(response.text)?.[1];
    if (id) return id;
  } catch {
    // segue para o fallback com API key
  }

  const key = secretValue('steam');
  if (key) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(vanity)}`;
      const response = await fetchText(url, { accept: 'application/json' });
      const payload = JSON.parse(response.text) as { response?: { success?: number; steamid?: string } };
      if (payload.response?.success === 1 && payload.response.steamid) return payload.response.steamid;
    } catch {
      // Chave inválida ou API indisponível: continua para o erro padrão.
    }
  }

  throw new ConnectorError('not_found', 'Perfil da Steam não encontrado. Confira o link ou use o SteamID64.');
}

async function fetchPersona(steamId: string): Promise<string | null> {
  try {
    const response = await fetchText(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
      accept: 'text/xml,application/xml'
    });
    const match =
      /<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/.exec(response.text) ??
      /<steamID>([\s\S]*?)<\/steamID>/.exec(response.text);
    return match?.[1] ? decodeEntities(stripHtml(match[1])) : null;
  } catch {
    return null;
  }
}

async function resolveProfile(input: string): Promise<{ steamId64: string; vanity: string | null; persona: string | null }> {
  const value = input.trim();
  let steamId64: string | null = null;
  let vanity: string | null = null;

  const profileMatch = /steamcommunity\.com\/profiles\/(\d{17})/i.exec(value);
  if (profileMatch?.[1]) steamId64 = profileMatch[1];

  if (!steamId64) {
    const vanityMatch = /steamcommunity\.com\/id\/([^/?#\s]+)/i.exec(value);
    if (vanityMatch?.[1]) vanity = vanityMatch[1];
  }

  if (!steamId64 && isSteamId64(value)) steamId64 = value;
  if (!steamId64 && !vanity && /^[A-Za-z0-9_.-]{2,40}$/.test(value)) vanity = value;

  if (!steamId64 && vanity) steamId64 = await resolveVanity(vanity);
  if (!steamId64) {
    throw new ConnectorError(
      'config',
      'Não reconheci o perfil. Use o SteamID64 (17 dígitos) ou o link steamcommunity.com/id/nome.'
    );
  }

  const persona = await fetchPersona(steamId64);
  return { steamId64, vanity, persona };
}

// ---------------------------------------------------------------------------
// Metadados da loja
// ---------------------------------------------------------------------------

function mapAppDetails(appid: number, entry: AppDetailsEntry | undefined): SteamAppMeta | null {
  const data = entry?.data;
  if (!entry?.success || !data?.name) return null;

  const price = data.price_overview;
  return {
    appid,
    name: data.name,
    coverUrl: data.capsule_image ?? data.header_image ?? null,
    headerUrl: data.header_image ?? data.capsule_image ?? null,
    steamBaseCents: price?.initial ?? (data.is_free ? 0 : null),
    steamFinalCents: price?.final ?? (data.is_free ? 0 : null),
    steamDiscount: price?.discount_percent ?? 0
  };
}

/** Busca metadados de vários appids (a API exige uma consulta por appid). */
export async function fetchSteamMetadata(
  appids: number[],
  settings: SettingsDto
): Promise<{ metadata: Map<number, SteamAppMeta>; failed: number }> {
  const result = new Map<number, SteamAppMeta>();
  let failed = 0;
  if (appids.length === 0) return { metadata: result, failed };

  for (let index = 0; index < appids.length; index += APP_BATCH_SIZE) {
    const batch = appids.slice(index, index + APP_BATCH_SIZE);
    const url = `https://store.steampowered.com/api/appdetails?appids=${batch.join(',')}&filters=basic,price_overview&cc=${regionCode(settings)}&l=portuguese`;

    try {
      const response = await fetchText(url, { accept: 'application/json', timeoutMs: 30_000 });
      const payload = JSON.parse(response.text) as Record<string, AppDetailsEntry>;
      let mappedCount = 0;
      for (const appid of batch) {
        const mapped = mapAppDetails(appid, payload[String(appid)]);
        if (mapped) {
          result.set(appid, mapped);
          mappedCount += 1;
        }
      }
      failed += batch.length - mappedCount;
    } catch {
      // Lote com falha: os jogos mantêm o cache anterior e tentamos de novo na próxima.
      failed += batch.length;
    }

    if (index + APP_BATCH_SIZE < appids.length) await sleep(APP_BATCH_DELAY_MS);
  }

  return { metadata: result, failed };
}

/** Metadados de um único appid (adicionar manualmente / buscar por link). */
export async function fetchSteamApp(appid: number, settings: SettingsDto): Promise<SteamAppMeta | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,price_overview&cc=${regionCode(settings)}&l=portuguese`;
  const response = await fetchText(url, { accept: 'application/json', timeoutMs: 20_000 });
  const payload = JSON.parse(response.text) as Record<string, AppDetailsEntry>;
  return mapAppDetails(appid, payload[String(appid)]);
}

interface StoreSearchItem {
  type?: string;
  id?: number;
  name?: string;
  tiny_image?: string;
  price?: { currency?: string; initial?: number; final?: number };
}

/** Busca jogos na loja da Steam por nome. */
export async function searchSteamGames(query: string, settings: SettingsDto): Promise<GameSearchResultDto[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=${regionCode(settings)}&l=portuguese`;
  const response = await fetchText(url, { accept: 'application/json', timeoutMs: 20_000 });

  let payload: { items?: StoreSearchItem[] };
  try {
    payload = JSON.parse(response.text) as { items?: StoreSearchItem[] };
  } catch {
    throw new ConnectorError('layout_changed', 'A busca da Steam devolveu uma resposta inesperada.');
  }

  return (payload.items ?? [])
    .filter((item) => item.type === 'app' && typeof item.id === 'number' && item.name)
    .slice(0, 10)
    .map((item) => ({
      appid: item.id as number,
      name: item.name as string,
      imageUrl: item.tiny_image ?? null,
      priceLabel:
        item.price && typeof item.price.final === 'number'
          ? formatMoney(item.price.final, item.price.currency ?? settings.currency)
          : null
    }));
}

// ---------------------------------------------------------------------------
// Conector
// ---------------------------------------------------------------------------

export const steamWishlistConnector: Connector = {
  type: 'steam-wishlist',
  defaultIntervalMinutes: 360,
  minIntervalMinutes: 120,

  async resolve(input: string, _settings: SettingsDto): Promise<ResolvedSourceDto> {
    const profile = await resolveProfile(input);
    return {
      name: profile.persona ? `Wishlist de ${profile.persona}` : 'Wishlist Steam',
      categoryId: 'game',
      config: {
        steamId64: profile.steamId64,
        vanity: profile.vanity,
        personaName: profile.persona,
        input
      },
      samples: []
    };
  },

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastSyncAt: string; total: number }>> {
    const steamId = typeof ctx.config.steamId64 === 'string' ? ctx.config.steamId64 : '';
    if (!isSteamId64(steamId)) {
      throw new ConnectorError('config', 'Fonte da Steam sem SteamID64 válido.');
    }

    const response = await fetchText(
      `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`,
      { accept: 'application/json', timeoutMs: 25_000 }
    );

    let items: WishlistItem[] = [];
    try {
      const payload = JSON.parse(response.text) as { response?: { items?: WishlistItem[] } };
      items = payload.response?.items ?? [];
    } catch {
      throw new ConnectorError('layout_changed', 'A Steam devolveu uma resposta inesperada para a wishlist.');
    }

    if (items.length === 0) {
      throw new ConnectorError(
        'private',
        'A wishlist está vazia ou privada. No Steam, abra Perfil → Editar perfil → Privacidade e deixe o perfil e os detalhes do jogo públicos.'
      );
    }

    const appids = items.map((item) => item.appid).filter((appid) => Number.isInteger(appid));
    const cached = new Map(getGamesByAppids(appids).map((game) => [game.appid, game]));
    const staleBefore = new Date(Date.now() - METADATA_TTL_MS).toISOString();
    const needMetadata = appids.filter((appid) => {
      const existing = cached.get(appid);
      return !existing?.metadata_fetched_at || existing.metadata_fetched_at < staleBefore;
    });

    ctx.logger.info(
      `Steam: ${items.length} jogo(s) na wishlist, ${needMetadata.length} metadado(s) a atualizar`
    );
    const { metadata: fresh, failed: metadataFailures } = await fetchSteamMetadata(
      needMetadata,
      ctx.settings
    );
    const fetchedAt = nowIso();

    const wishlist: RawWishlistGame[] = items
      .filter((item) => Number.isInteger(item.appid))
      .map((item) => {
        const existing = cached.get(item.appid);
        const meta = fresh.get(item.appid);
        return {
          appid: item.appid,
          name: meta?.name ?? existing?.name ?? `Jogo ${item.appid}`,
          coverUrl: meta?.coverUrl ?? existing?.cover_url ?? null,
          headerUrl: meta?.headerUrl ?? existing?.header_url ?? null,
          steamBaseCents: meta?.steamBaseCents ?? existing?.steam_base_cents ?? null,
          steamFinalCents: meta?.steamFinalCents ?? existing?.steam_final_cents ?? null,
          steamDiscount: meta?.steamDiscount ?? existing?.steam_discount ?? 0,
          priority: typeof item.priority === 'number' ? item.priority : null,
          dateAdded: item.date_added ? new Date(item.date_added * 1000).toISOString() : null,
          metadataFresh: Boolean(meta),
          metadataFetchedAt: meta ? fetchedAt : (existing?.metadata_fetched_at ?? null)
        };
      });

    return {
      items: [],
      state: { lastSyncAt: fetchedAt, total: wishlist.length },
      wishlist,
      warnings:
        metadataFailures > 0
          ? [
              `${metadataFailures} jogo(s) sem metadados da Steam nesta sincronização; os nomes podem aparecer como "Jogo appid". Nova tentativa na próxima execução.`
            ]
          : undefined
    };
  }
};
