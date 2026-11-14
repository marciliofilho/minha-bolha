/** Rótulos curtos para os diagnósticos de addon exibidos na interface. */
import type { AddonDiagnosticCode } from '@hub/shared';

export const ADDON_DIAGNOSTIC_LABELS: Record<AddonDiagnosticCode, string> = {
  dns: 'DNS do addon não resolve',
  timeout: 'Tempo esgotado',
  auth: 'Requer autenticação',
  blocked: 'Acesso bloqueado',
  not_found: 'Recurso não encontrado (404)',
  rate_limited: 'Muitas requisições (429)',
  http: 'Erro HTTP',
  invalid: 'URL ou resposta inválida',
  network: 'Erro de rede',
  empty: 'Nenhum stream retornado',
  pending: 'Ainda respondendo',
  unknown: 'Erro desconhecido'
};

export function addonDiagnosticLabel(code: AddonDiagnosticCode): string {
  return ADDON_DIAGNOSTIC_LABELS[code] ?? ADDON_DIAGNOSTIC_LABELS.unknown;
}
