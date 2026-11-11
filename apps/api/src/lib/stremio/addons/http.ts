/**
 * HTTP dos addons: timeouts curtos, limite de tamanho e redirects validados.
 * Como o usuário cadastra a URL manualmente, localhost/LAN são permitidos;
 * apenas destinos de metadados ficam bloqueados.
 */
import type { SourceErrorCode } from '@hub/shared';
import { ADDON_MAX_BYTES, ADDON_TIMEOUT_MS, addonOrigin, assertAllowedAddonHost } from './manifest';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

export class AddonHttpError extends Error {
  readonly status: number;
  readonly code: SourceErrorCode;
  readonly helpUrl: string | null;

  constructor(
    message: string,
    status: number,
    code: SourceErrorCode,
    helpUrl: string | null = null
  ) {
    super(message);
    this.name = 'AddonHttpError';
    this.status = status;
    this.code = code;
    this.helpUrl = helpUrl;
  }
}

function statusError(status: number, url: string, body = ''): AddonHttpError {
  const origin = addonOrigin(url);
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
      helpUrl
    );
  }
  if (status === 403) {
    return new AddonHttpError(`O addon em ${origin} recusou o acesso (HTTP 403).${detail}`, status, 'blocked', helpUrl);
  }
  if (status === 404 || status === 410) {
    return new AddonHttpError(`O addon em ${origin} não encontrou o recurso (HTTP ${status}).`, status, 'not_found');
  }
  if (status === 429) {
    return new AddonHttpError(`O addon em ${origin} limitou as requisições (HTTP 429).`, status, 'rate_limited');
  }
  return new AddonHttpError(`O addon em ${origin} respondeu HTTP ${status}.${detail}`, status, 'network');
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
    throw new AddonHttpError('URL do addon inválida.', 0, 'config');
  }

  for (let hop = 0; hop <= 3; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new AddonHttpError('O addon precisa usar http ou https.', 0, 'config');
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
      throw new AddonHttpError(
        name === 'TimeoutError' || name === 'AbortError'
          ? `O addon em ${addonOrigin(current.toString())} demorou demais para responder.`
          : `Não foi possível falar com o addon em ${addonOrigin(current.toString())}.`,
        0,
        'network'
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === 3) {
        throw new AddonHttpError('O addon redirecionou demais ou sem destino.', response.status, 'network');
      }
      try {
        current = new URL(location, current);
      } catch {
        throw new AddonHttpError('O addon redirecionou para uma URL inválida.', response.status, 'network');
      }
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw statusError(response.status, current.toString(), body.slice(0, 2000));
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > ADDON_MAX_BYTES) {
      throw new AddonHttpError('A resposta do addon é grande demais.', response.status, 'network');
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > ADDON_MAX_BYTES) {
      throw new AddonHttpError('A resposta do addon excedeu o limite de tamanho.', response.status, 'network');
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
        'layout_changed'
      );
    }

    return {
      data,
      elapsedMs: Date.now() - started,
      status: response.status,
      finalUrl: current.toString()
    };
  }

  throw new AddonHttpError('Não foi possível carregar o addon.', 0, 'network');
}
