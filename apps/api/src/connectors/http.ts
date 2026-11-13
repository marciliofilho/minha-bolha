/**
 * Cliente HTTP único para todos os conectores.
 * Timeout, retry, limite de tamanho e tradução de erros para ConnectorError.
 */
import { ConnectorError } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Hub/0.1 (+local personal reader)';

export interface HttpResult {
  text: string;
  status: number;
  contentType: string;
  finalUrl: string;
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  maxBytes?: number;
  retries?: number;
  accept?: string;
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<HttpResult> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        method: options.method ?? 'GET',
        body: options.body,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
          ...(options.body ? { 'content-type': options.contentType ?? 'application/json' } : {}),
          ...options.headers
        }
      });

      if (!response.ok) {
        const retriable = response.status === 429 || response.status >= 500;
        if (retriable && attempt < retries) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw statusError(response.status, url);
      }

      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        throw new ConnectorError('network', `Resposta grande demais (${Math.round(declared / 1024)} KB).`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        throw new ConnectorError('network', 'Resposta excedeu o limite de tamanho.');
      }
      const charset = detectCharset(contentType, bytes);
      let text: string;
      try {
        text = new TextDecoder(charset).decode(bytes);
      } catch {
        text = bytes.toString('utf8');
      }

      return {
        text,
        status: response.status,
        contentType,
        finalUrl: response.url || url
      };
    } catch (error) {
      lastError = error;
      if (error instanceof ConnectorError) throw error;
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
    }
  }

  if (lastError instanceof Error && lastError.name === 'TimeoutError') {
    throw new ConnectorError('network', 'O site demorou demais para responder.');
  }
  throw new ConnectorError('network', lastError instanceof Error ? lastError.message : 'Falha de rede.');
}

/**
 * Muitos feeds de notícias ainda usam ISO-8859-1/Windows-1252. O `text()`
 * padrão do fetch decodifica sempre como UTF-8 e transforma "André" em
 * "Andr?". Lemos os bytes e respeitamos o charset do header ou do XML.
 */
function detectCharset(contentType: string, bytes: Buffer): string {
  const fromHeader = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1];
  let label = fromHeader?.trim();
  if (!label) {
    const head = bytes.subarray(0, 1024).toString('latin1');
    label =
      /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head)?.[1] ??
      /<meta[^>]+charset=["']?([^"'"\s/>]+)/i.exec(head)?.[1] ??
      'utf-8';
  }
  const normalized = label.toLowerCase();
  if (normalized === 'iso-8859-1' || normalized === 'latin1' || normalized === 'latin-1') {
    return 'windows-1252';
  }
  try {
    new TextDecoder(normalized);
    return normalized;
  } catch {
    return 'utf-8';
  }
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'servidor remoto';
  }
}

function statusError(status: number, url: string): ConnectorError {
  const safe = sanitizeUrl(url);
  if (status === 401) {
    return new ConnectorError('auth', `Autenticação recusada (HTTP 401) em ${safe}. Confira a chave da API.`);
  }
  if (status === 403) {
    return new ConnectorError('blocked', `Acesso negado (HTTP 403) em ${safe}.`);
  }
  if (status === 404 || status === 410) {
    return new ConnectorError('not_found', `Endereço não encontrado (HTTP ${status}).`);
  }
  if (status === 429) {
    return new ConnectorError('rate_limited', 'O site limitou as requisições (HTTP 429).');
  }
  return new ConnectorError('network', `Resposta inesperada do servidor (HTTP ${status}).`);
}
