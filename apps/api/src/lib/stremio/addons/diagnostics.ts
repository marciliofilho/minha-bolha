import type { AddonDiagnosticCode } from '@hub/shared';

/** Classifica um status HTTP em um diagnóstico curto para a interface. */
export function diagnosticForStatus(status: number): AddonDiagnosticCode {
  if (status === 401) return 'auth';
  if (status === 403) return 'blocked';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 429) return 'rate_limited';
  return status > 0 ? 'http' : 'unknown';
}
