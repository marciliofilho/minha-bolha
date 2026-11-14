/** Aguarda a sincronização real de uma fonte após o POST de refresh. */
import { api } from './api';
import { subscribeSourceStatus } from './realtime';

interface RefreshResponse {
  queued: boolean;
  reason?: 'cooldown';
}

/**
 * A API responde 202 assim que o job entra na fila. Este helper usa o SSE
 * `source:status` e, como rede de segurança, uma consulta leve periódica.
 */
export async function waitForSourceRefresh(
  source: { id: string; lastCheckedAt: string | null },
  request: () => Promise<RefreshResponse>,
  timeoutMs = 90_000
): Promise<void> {
  const result = await request();
  if (result.queued === false && result.reason === 'cooldown') return;

  await new Promise<void>((resolve) => {
    let finished = false;
    let pollTimer: number | null = null;
    let deadlineTimer: number | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = (): void => {
      unsubscribe?.();
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (deadlineTimer !== null) window.clearTimeout(deadlineTimer);
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };

    unsubscribe = subscribeSourceStatus((sourceId, _ok, lastCheckedAt) => {
      if (sourceId !== source.id) return;
      if (!lastCheckedAt || lastCheckedAt !== source.lastCheckedAt) finish();
    });

    deadlineTimer = window.setTimeout(finish, timeoutMs);
    pollTimer = window.setInterval(() => {
      void api
        .sourceStatuses()
        .then(({ sources }) => {
          const updated = sources.find((candidate) => candidate.id === source.id);
          if (updated && updated.lastCheckedAt !== source.lastCheckedAt) finish();
        })
        .catch(() => undefined);
    }, 5_000);
  });
}
