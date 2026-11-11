/**
 * Extração usando o navegador do Feed do app desktop.
 *
 * O app sobe um serviço local que abre a página na MESMA sessão do navegador
 * do Feed (`persist:hub-browser`), onde a verificação da Webnovel já funciona.
 * Assim o conteúdo é extraído sem depender do perfil/CDP da janela live.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('desktop-extract');

let cachedPort: string | null = null;
let cachedMtime = 0;

function portFromFile(): string | null {
  try {
    const file = join(dirname(env.dbPath), 'desktop-extract.json');
    const stat = statSync(file);
    if (stat.mtimeMs !== cachedMtime) {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as { port?: number | string };
      cachedMtime = stat.mtimeMs;
      cachedPort = doc?.port ? String(doc.port) : null;
    }
    return cachedPort;
  } catch {
    return null;
  }
}

/** Porta do serviço de extração do app desktop, se ele estiver rodando. */
export function desktopExtractPort(): string | null {
  return process.env.HUB_EXTRACT_PORT?.trim() || portFromFile();
}

export interface DesktopExtractOptions {
  url: string;
  readyExpression: string;
  expression: string;
  timeoutMs?: number;
  /** Permite o fallback por HTML (capítulos). */
  fallback?: boolean;
}

export interface DesktopExtractResult<T> {
  data: T | null;
  title: string;
  finalUrl: string;
}

export async function extractViaDesktop<T>(
  options: DesktopExtractOptions
): Promise<DesktopExtractResult<T>> {
  const port = desktopExtractPort();
  if (!port) {
    throw new Error('navegador do Feed indisponível');
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: options.url,
        readyExpression: options.readyExpression,
        expression: options.expression,
        timeoutMs,
        fallback: options.fallback === true
      }),
      signal: AbortSignal.timeout(timeoutMs + 15_000)
    });
  } catch (error) {
    log.warn(
      `não foi possível falar com o app desktop: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw new Error('navegador do Feed indisponível');
  }

  if (!response.ok) {
    let message = `falha na extração (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // resposta sem JSON
    }
    throw new Error(message);
  }

  return (await response.json()) as DesktopExtractResult<T>;
}
