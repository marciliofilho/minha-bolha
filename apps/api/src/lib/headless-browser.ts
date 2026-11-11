/**
 * Navegador headless local para páginas protegidas por Cloudflare.
 *
 * Usa o navegador auxiliar do app (Electron/Chromium embutido) via CDP, sem
 * baixar Chrome, Edge ou qualquer dependência externa. A janela de scraping é
 * fixa, oculta e sem entrada na barra de tarefas.
 */
import {
  browserUserAgent,
  ensureBrowserHost,
  restartBrowserHost,
  targetWebSocketUrl
} from './browser-host';

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_MS = 400;

export interface RenderPageOptions {
  url: string;
  /** Expressão JS que precisa ser verdadeira antes de extrair os dados. */
  readyExpression: string;
  /** Expressão JS cujo resultado JSON será devolvido. */
  expression: string;
  /** Ação opcional após o carregamento (ex.: abrir a aba de capítulos). */
  prepareExpression?: string;
  prepareWaitMs?: number;
  timeoutMs?: number;
  pollMs?: number;
  /** User-agent específico (ex.: versão móvel). */
  userAgent?: string;
}

export interface RenderPageResult<T> {
  data: T | null;
  title: string;
  finalUrl: string;
  bodyText: string;
}

interface CdpConnection {
  ready: Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(wsUrl: string): CdpConnection {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  let closed = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  const failAll = (reason: string) => {
    closed = true;
    for (const request of pending.values()) request.reject(new Error(reason));
    pending.clear();
  };

  ws.addEventListener('message', (event) => {
    let message: { id?: number; error?: { message?: string }; result?: unknown };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? 'Falha no CDP.'));
    else request.resolve(message.result);
  });

  ws.addEventListener('close', () => failAll('A conexão com o navegador foi encerrada.'));
  ws.addEventListener('error', () => failAll('Erro na conexão com o navegador.'));

  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('Não foi possível conectar ao navegador.')), {
        once: true
      });
    }),
    send(method, params = {}) {
      if (closed) return Promise.reject(new Error('A conexão com o navegador foi encerrada.'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`O navegador não respondeu a ${method}.`));
        }, 20_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (reason) => {
            clearTimeout(timer);
            reject(reason);
          }
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        // ignora
      }
    }
  };
}

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
`;

/** Script já injetado na janela fixa; evita empilhar duplicatas a cada scrape. */
let stealthHostKey: number | null = null;

async function renderPageOnce<T>(
  options: RenderPageOptions
): Promise<RenderPageResult<T>> {
  const host = await ensureBrowserHost();
  const userAgent = options.userAgent ?? (await browserUserAgent(host));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;

  let connection: CdpConnection | null = null;
  try {
    connection = connect(targetWebSocketUrl(host, 'scrape'));
    await connection.ready;
    await connection.send('Page.enable');
    await connection.send('Runtime.enable');
    await connection.send('Network.enable');
    await connection.send('Network.setUserAgentOverride', {
      userAgent,
      acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8',
      platform: 'Win32'
    });

    if (stealthHostKey !== host.restartKey) {
      await connection.send('Page.addScriptToEvaluateOnNewDocument', {
        source: STEALTH_SCRIPT
      });
      stealthHostKey = host.restartKey;
    }

    // Cancela uma navegação anterior que tenha ficado pendente.
    await connection.send('Page.stopLoading').catch(() => undefined);
    await connection.send('Page.navigate', { url: options.url });

    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const probe = (await connection.send('Runtime.evaluate', {
          expression: `Boolean(${options.readyExpression})`,
          returnByValue: true
        })) as { result?: { value?: unknown } };
        if (probe.result?.value === true) {
          ready = true;
          break;
        }
      } catch {
        // contexto ainda navegando
      }
      await delay(pollMs);
    }

    if (!ready) {
      throw new Error('O site não terminou de carregar dentro do tempo esperado.');
    }

    if (options.prepareExpression) {
      let prepared = false;
      try {
        const result = (await connection.send('Runtime.evaluate', {
          expression: options.prepareExpression,
          returnByValue: true
        })) as { result?: { value?: unknown } };
        prepared = result.result?.value === true;
      } catch {
        // A ação é opcional; se falhar, seguimos com o que já está na página.
      }

      if (prepared) {
        await delay(options.prepareWaitMs ?? 1500);

        // A ação pode ter navegado ou renderizado conteúdo novo; confirma de novo.
        const prepareDeadline = Date.now() + 8_000;
        while (Date.now() < prepareDeadline) {
          try {
            const probe = (await connection.send('Runtime.evaluate', {
              expression: `Boolean(${options.readyExpression})`,
              returnByValue: true
            })) as { result?: { value?: unknown } };
            if (probe.result?.value === true) break;
          } catch {
            // contexto trocando
          }
          await delay(300);
        }
      }
    }

    // Pequena pausa para hidratação do restante da página.
    await delay(300);

    const extracted = (await connection.send('Runtime.evaluate', {
      expression: `JSON.stringify(${options.expression})`,
      returnByValue: true,
      awaitPromise: true
    })) as { result?: { value?: string }; exceptionDetails?: unknown };

    if (extracted.exceptionDetails) {
      throw new Error('Não foi possível extrair os dados da página.');
    }

    const meta = (await connection.send('Runtime.evaluate', {
      expression:
        "JSON.stringify({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 500) : '' })",
      returnByValue: true
    })) as { result?: { value?: string } };
    const metaValue = meta.result?.value
      ? (JSON.parse(meta.result.value) as {
          title?: string;
          url?: string;
          text?: string;
        })
      : {};

    const data = extracted.result?.value
      ? (JSON.parse(extracted.result.value) as T)
      : null;

    return {
      data,
      title: metaValue.title ?? '',
      finalUrl: metaValue.url ?? options.url,
      bodyText: metaValue.text ?? ''
    };
  } finally {
    connection?.close();
  }
}

function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /conectar|ECONN|closed|WebSocket|Target closed|navegador auxiliar/i.test(message);
}

async function renderPage<T>(options: RenderPageOptions): Promise<RenderPageResult<T>> {
  try {
    return await renderPageOnce<T>(options);
  } catch (error) {
    if (!isConnectionError(error)) throw error;

    // O processo do navegador pode ter sido encerrado; sobe de novo e tenta uma vez.
    await restartBrowserHost().catch(() => undefined);
    return renderPageOnce<T>(options);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Serializa o uso do navegador para não abrir várias instâncias. */
export function renderPageJson<T>(options: RenderPageOptions): Promise<RenderPageResult<T>> {
  const next = queue.then(
    () => renderPage<T>(options),
    () => renderPage<T>(options)
  );
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}
