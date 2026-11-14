/**
 * HTTP dos addons: timeouts curtos, limite de tamanho e redirects validados.
 * Como o usuário cadastra a URL manualmente, localhost/LAN são permitidos;
 * apenas destinos de metadados ficam bloqueados.
 */
import type { AddonDiagnosticCode, SourceErrorCode } from '@hub/shared';
import { diagnosticForStatus } from './diagnostics';
import { ADDON_MAX_BYTES, ADDON_TIMEOUT_MS, addonOrigin, assertAllowedAddonHost } from './manifest';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function hostFor(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function defaultDiagnostic(
  code: SourceErrorCode,
  status: number
): AddonDiagnosticCode {
  if (code === 'auth') return 'auth';
  if (code === 'blocked') return 'blocked';
  if (code === 'not_found') return 'not_found';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'config' || code === 'layout_changed') return 'invalid';
  if (code === 'network') return 'network';
  return diagnosticForStatus(status);
}

export class AddonHttpError extends Error {
  readonly status: number;
  readonly code: SourceErrorCode;
  readonly helpUrl: string | null;
  readonly diagnostic: AddonDiagnosticCode;
  readonly host: string | null;

  constructor(
    message: string,
    status: number,
    code: SourceErrorCode,
    helpUrl: string | null = null,
    diagnostic: AddonDiagnosticCode = defaultDiagnostic(code, status),
    host: string | null = null
  ) {
    super(message);
    this.name = 'AddonHttpError';
    this.status = status;
    this.code = code;
    this.helpUrl = helpUrl;
    this.diagnostic = diagnostic;
    this.host = host;
  }
}

function statusError(status: number, url: string, body = ''): AddonHttpError {
  const origin = addonOrigin(url);
  const host = hostFor(url);
  let detail = '';
  let helpUrl: string | null = null;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; login?: unknown; message?: unknown };
    const message = parsed.error ?? parsed.message;
    if (typeof message === 'string' && message.trim()) detail = ` ${message.trim()}`;
    if (typeof parsed.login === 'string' && parsed.login.trim()) {
      try {
        helpUrl = new URL(parsed.login, url).toString();
      } catch {
        helpUrl = null;
      }
    }
  } catch {
    // Corpo não-JSON; a mensagem padrão já basta.
  }

  if (status === 401) {
    return new AddonHttpError(
      `O addon em ${origin} exige configuração/autenticação (HTTP 401).${detail}`,
      status,
      'auth',
      helpUrl,
      'auth',
      host
    );
  }
  if (status === 403) {
    return new AddonHttpError(
      `O addon em ${origin} recusou o acesso (HTTP 403).${detail}`,
      status,
      'blocked',
      helpUrl,
      'blocked',
      host
    );
  }
  if (status === 404 || status === 410) {
    return new AddonHttpError(
      `O addon em ${origin} não encontrou o recurso (HTTP ${status}).`,
      status,
      'not_found',
      null,
      'not_found',
      host
    );
  }
  if (status === 429) {
    return new AddonHttpError(
      `O addon em ${origin} limitou as requisições (HTTP 429).`,
      status,
      'rate_limited',
      null,
      'rate_limited',
      host
    );
  }
  return new AddonHttpError(
    `O addon em ${origin} respondeu HTTP ${status}.${detail}`,
    status,
    'network',
    null,
    'http',
    host
  );
}

export interface AddonFetchResult {
  data: unknown;
  elapsedMs: number;
  status: number;
  finalUrl: string;
}

export async function fetchAddonJson(
  url: string,
  timeoutMs: number = ADDON_TIMEOUT_MS
): Promise<AddonFetchResult> {
  const started = Date.now();
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new AddonHttpError('URL do addon inválida.', 0, 'config', null, 'invalid', null);
  }

  for (let hop = 0; hop <= 3; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new AddonHttpError(
        'O addon precisa usar http ou https.',
        0,
        'config',
        null,
        'invalid',
        current.host
      );
    }
    assertAllowedAddonHost(current);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/json, */*;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
          'user-agent': USER_AGENT
        }
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const causeCode =
        typeof (error as { cause?: { code?: unknown } }).cause?.code === 'string'
          ? String((error as { cause?: { code?: unknown } }).cause?.code)
          : '';
      const timeout =
        name === 'TimeoutError' ||
        name === 'AbortError' ||
        causeCode.includes('TIMEOUT') ||
        causeCode === 'ETIMEDOUT';
      const dns =
        causeCode === 'ENOTFOUND' ||
        causeCode === 'EAI_AGAIN' ||
        causeCode === 'ENODATA' ||
        causeCode === 'ESERVFAIL';
      const host = current.host;
      const origin = addonOrigin(current.toString());
      const message = dns
        ? `O domínio do addon não foi encontrado no DNS: ${host}. Confira se o endereço está correto.`
        : timeout
          ? `O addon em ${origin} demorou mais de ${Math.round(timeoutMs / 1000)}s para responder.`
          : `Não foi possível falar com o addon em ${origin}${
              causeCode ? ` (${causeCode})` : ''
            }.`;
      throw new AddonHttpError(
        message,
        0,
        'network',
        null,
        dns ? 'dns' : timeout ? 'timeout' : 'network',
        host
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === 3) {
        throw new AddonHttpError(
          'O addon redirecionou demais ou sem destino.',
          response.status,
          'network',
          null,
          'invalid',
          current.host
        );
      }
      try {
        current = new URL(location, current);
      } catch {
        throw new AddonHttpError(
          'O addon redirecionou para uma URL inválida.',
          response.status,
          'network',
          null,
          'invalid',
          current.host
        );
      }
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw statusError(response.status, current.toString(), body.slice(0, 2000));
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > ADDON_MAX_BYTES) {
      throw new AddonHttpError(
        'A resposta do addon é grande demais.',
        response.status,
        'network',
        null,
        'http',
        current.host
      );
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > ADDON_MAX_BYTES) {
      throw new AddonHttpError(
        'A resposta do addon excedeu o limite de tamanho.',
        response.status,
        'network',
        null,
        'http',
        current.host
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      throw new AddonHttpError(
        contentType.includes('text/html')
          ? 'O addon devolveu uma página HTML em vez de JSON. Ele pode estar descontinuado ou a URL do manifest está incorreta.'
          : 'O addon devolveu uma resposta que não é JSON.',
        response.status,
        'layout_changed',
        null,
        'invalid',
        current.host
      );
    }

    return {
      data,
      elapsedMs: Date.now() - started,
      status: response.status,
      finalUrl: current.toString()
    };
  }

  throw new AddonHttpError(
    'Não foi possível carregar o addon.',
    0,
    'network',
    null,
    'network',
    current.host
  );
}
