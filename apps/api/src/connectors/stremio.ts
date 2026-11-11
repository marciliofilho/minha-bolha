/**
 * Conector da biblioteca do Stremio.
 * SOMENTE LEITURA: usa datastoreGet; nunca adiciona ou remove itens.
 */
import type { Connector, ConnectorContext, FetchResult } from './types';
import { ConnectorError } from './types';
import { getStremioAuthKey } from '../lib/stremio/account';
import { fetchStremioLibrary, StremioApiError } from '../lib/stremio/api';
import { markStremioExpired } from '../db/repositories/stremio';
import { nowIso } from '../lib/dates';

export const stremioConnector: Connector = {
  type: 'stremio-library',
  defaultIntervalMinutes: 60,
  minIntervalMinutes: 30,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastSyncAt: string; count: number }>> {
    const authKey = getStremioAuthKey();
    if (!authKey) {
      throw new ConnectorError(
        'auth',
        'Stremio não conectado ou sessão expirada. Conecte em Configurações → Stremio.'
      );
    }

    try {
      const items = await fetchStremioLibrary(authKey);
      ctx.logger.info(`Stremio: ${items.length} item(ns) na biblioteca`);
      return {
        items: [],
        state: { lastSyncAt: nowIso(), count: items.length },
        stremioLibrary: items
      };
    } catch (error) {
      if (error instanceof StremioApiError && error.status === 401) {
        markStremioExpired();
        throw new ConnectorError(
          'auth',
          'Sessão do Stremio expirada. Reconecte em Configurações → Stremio.'
        );
      }
      throw new ConnectorError(
        'network',
        error instanceof Error ? error.message : 'Falha ao ler a biblioteca do Stremio.'
      );
    }
  }
};
