/** Fonte automática do calendário global. */
import type { SourceDto } from '@hub/shared';
import { createSource, listSources, updateSource } from '../db/repositories/sources';

export function getGlobalReleasesSource(): SourceDto | null {
  return listSources().find((source) => source.type === 'global-releases') ?? null;
}

/** Cria/ativa a fonte do calendário global, sem depender de chaves. */
export function ensureGlobalReleasesSource(): SourceDto {
  const existing = getGlobalReleasesSource();
  if (existing) {
    if (!existing.enabled) return updateSource(existing.id, { enabled: true }) ?? existing;
    return existing;
  }

  return createSource({
    type: 'global-releases',
    name: 'Calendário global',
    categoryId: 'other',
    config: { provider: 'global' },
    intervalMinutes: 360
  });
}
