/** Regras puras do agendamento das novels, sem acesso ao banco. */

export const NOVEL_MANUAL_COOLDOWN_MS = 5 * 60_000;
export const NOVEL_START_SPACING_MS = 2_000;

/** Tempo restante do cooldown de refresh manual de uma novel, em ms. */
export function novelCooldownRemainingMs(
  type: string,
  lastCheckedAt: string | null | undefined,
  now = Date.now()
): number {
  if (type !== 'webnovel' || !lastCheckedAt) return 0;
  const checked = Date.parse(lastCheckedAt);
  if (!Number.isFinite(checked)) return 0;
  const elapsed = now - checked;
  if (elapsed < 0) return 0;
  return Math.max(0, NOVEL_MANUAL_COOLDOWN_MS - elapsed);
}

/** Uma novel só pode iniciar depois do intervalo mínimo desde a anterior. */
export function canStartNovel(now: number, nextNovelStartAt: number): boolean {
  return now >= nextNovelStartAt;
}

export function nextNovelStartAfter(now: number): number {
  return now + NOVEL_START_SPACING_MS;
}
