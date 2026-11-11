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

/** Resultado do último health check do serviço do app desktop. */
let availability: { port: string; at: number; ok: boolean } | null = null;
const AVAILABILITY_TTL_MS = 30_000;

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

/**
 * Confirma que o serviço do app desktop está realmente ouvindo. Evita tentar
 * uma porta antiga deixada em `desktop-extract.json` quando a API roda sozinha.
 */
export async function desktopExtractAvailable(): Promise<string | null> {
  const port = desktopExtractPort();
  if (!port) {
    availability = null;
    return null;
  }
  const now = Date.now();
  if (availability?.port === port && now - availability.at < AVAILABILITY_TTL_MS) {
    return availability.ok ? port : null;
  }

  let ok = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_200)
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  availability = { port, at: Date.now(), ok };
  if (!ok) {
    log.debug(`extração pelo app desktop indisponível na porta ${port}`);
  }
  return ok ? port : null;
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
  const port = await desktopExtractAvailable();
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
    // O desktop pode ter fechado entre o health check e a extração.
    availability = { port, at: Date.now(), ok: false };
    log.debug(
      `app desktop deixou de responder: ${
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
