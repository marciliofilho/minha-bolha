/** Conexão SSE com a API: mantém o feed e os contadores atualizados. */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FAVORITES_TAB_ID, WATCH_LATER_TAB_ID } from '@hub/shared';

interface RealtimeMessage {
  type: string;
  [key: string]: unknown;
}

/** Agrupa os eventos de uma sincronização para não refazer o feed a cada item. */
const INVALIDATE_DELAY_MS = 700;

export function useRealtime(): void {
  const queryClient = useQueryClient();
  const pending = useRef({
    feed: false,
    counts: false,
    sources: false,
    health: false
  });
  const timer = useRef<number | null>(null);
  const refreshActive = useRef(0);
  const feedPending = useRef(false);

  useEffect(() => {
    const refreshFeed = (): void => {
      // Itens novos nunca nascem favoritos/ver depois e um feed já rolado
      // (várias páginas) não deve reler tudo a cada sincronização.
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ['feed'] })) {
        const tab = String(query.queryKey[1] ?? '');
        if (tab === FAVORITES_TAB_ID || tab === WATCH_LATER_TAB_ID) continue;
        const pages = (query.state.data as { pages?: unknown[] } | undefined)?.pages?.length ?? 0;
        if (pages > 1) {
          void queryClient.invalidateQueries({
            queryKey: query.queryKey,
            exact: true,
            refetchType: 'none'
          });
        } else {
          void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
        }
      }
    };

    const flush = (): void => {
      timer.current = null;
      const flags = pending.current;
      pending.current = { feed: false, counts: false, sources: false, health: false };

      if (flags.feed) {
        // Durante uma sincronização longa, espera ela terminar para atualizar
        // o feed uma única vez em vez de recarregar a cada item novo.
        if (refreshActive.current > 0) {
          feedPending.current = true;
        } else {
          feedPending.current = false;
          refreshFeed();
        }
      }
      if (flags.counts) void queryClient.invalidateQueries({ queryKey: ['counts'] });
      if (flags.sources) void queryClient.invalidateQueries({ queryKey: ['sources'] });
      if (flags.health) void queryClient.invalidateQueries({ queryKey: ['health'] });
    };

    const queue = (flags: Partial<typeof pending.current>): void => {
      Object.assign(pending.current, flags);
      if (timer.current !== null) return;
      timer.current = window.setTimeout(flush, INVALIDATE_DELAY_MS);
    };

    const source = new EventSource('/api/events');

    source.onmessage = (event) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(event.data) as RealtimeMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'items:new':
          queue({ feed: true, counts: true, sources: true, health: true });
          if (Array.isArray(message.items) && message.items.length > 0) {
            window.dispatchEvent(
              new CustomEvent('hub:items-new', { detail: message.items })
            );
          }
          break;

        case 'source:status':
          queue({
            sources: true,
            health: true,
            ...(message.ok === false ? { counts: true } : {})
          });
          void queryClient.invalidateQueries({ queryKey: ['calendar'] });
          break;

        case 'calendar:changed':
          void queryClient.invalidateQueries({ queryKey: ['calendar'] });
          queue({ sources: true });
          break;

        case 'games:changed':
          void queryClient.invalidateQueries({ queryKey: ['games'] });
          void queryClient.invalidateQueries({ queryKey: ['game'] });
          queue({ sources: true, health: true });
          break;

        case 'secrets:changed':
          void queryClient.invalidateQueries({ queryKey: ['secrets'] });
          void queryClient.invalidateQueries({ queryKey: ['status'] });
          void queryClient.invalidateQueries({ queryKey: ['sources'] });
          void queryClient.invalidateQueries({ queryKey: ['games'] });
          queue({ health: true });
          break;

        case 'stremio:changed':
          void queryClient.invalidateQueries({ queryKey: ['stremio-status'] });
          void queryClient.invalidateQueries({ queryKey: ['stremio-library'] });
          void queryClient.invalidateQueries({ queryKey: ['stremio-addons'] });
          void queryClient.invalidateQueries({ queryKey: ['stremio-catalogs'] });
          void queryClient.invalidateQueries({ queryKey: ['stremio-catalog'] });
          void queryClient.invalidateQueries({ queryKey: ['sources'] });
          void queryClient.invalidateQueries({ queryKey: ['feed'] });
          void queryClient.invalidateQueries({ queryKey: ['counts'] });
          void queryClient.invalidateQueries({ queryKey: ['calendar'] });
          break;

        case 'refresh:state': {
          const active = typeof message.active === 'number' ? message.active : 0;
          const queued = typeof message.queued === 'number' ? message.queued : 0;
          refreshActive.current = active + queued;
          queryClient.setQueryData(['refresh-state'], { active, queued });
          if (active === 0 && queued === 0 && feedPending.current) {
            feedPending.current = false;
            refreshFeed();
          }
          break;
        }

        case 'demo:changed':
        case 'categories:changed':
          void queryClient.invalidateQueries();
          break;

        default:
          break;
      }
    };

    return () => {
      source.close();
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [queryClient]);
}
