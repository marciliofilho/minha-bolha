/** Aguarda a sincronização real de uma fonte após o POST de refresh. */
import { api } from './api';

interface RefreshResponse {
  queued: boolean;
  reason?: 'cooldown';
}

/**
 * A API responde 202 assim que o job entra na fila. Este helper mantém o
 * spinner até a fonte terminar (lastCheckedAt mudar) ou até o timeout.
 */
export async function waitForSourceRefresh(
  source: { id: string; lastCheckedAt: string | null },
  request: () => Promise<RefreshResponse>,
  timeoutMs = 90_000
): Promise<void> {
  const result = await request();
  if (result.queued === false && result.reason === 'cooldown') return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    const latest = await api.sources();
    const updated = latest.sources.find((candidate) => candidate.id === source.id);
    if (updated && updated.lastCheckedAt !== source.lastCheckedAt) return;
  }
}
