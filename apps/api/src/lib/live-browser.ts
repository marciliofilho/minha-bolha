/**
 * Navegador Chromium real controlado pelo Hub (Puppeteer embutido).
 *
 * É usado pelo card "Browser" do Feed quando o site bloqueia iframe. A tela é
 * capturada como JPEG e os cliques/teclas são encaminhados ao Chromium real.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { browserUserAgent, ensureBrowserHost } from './browser-host';
import { canonicalizeWebnovelUrl, isWebnovelUrl, toMobileUrl } from './webnovel-url';
import { createLogger } from './logger';

export { canonicalizeWebnovelUrl, isWebnovelUrl, toMobileUrl } from './webnovel-url';

const log = createLogger('live-browser');

const VIEWPORT = { width: 1280, height: 720 };
const IDLE_MS = 10 * 60_000;
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
`;

export interface LiveBrowserState {
  url: string;
  title: string;
  screenshot: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type LiveBrowserAction = 'back' | 'forward' | 'reload';

export type LiveBrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string };

let browser: Browser | null = null;
let page: Page | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let lastState: LiveBrowserState = {
  url: '',
  title: '',
  screenshot: null,
  canGoBack: false,
  canGoForward: false
};

let queue: Promise<unknown> = Promise.resolve();

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/** Serializa ações: o Chromium não lida bem com screenshot e clique ao mesmo tempo. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void stopLiveBrowser();
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function historyFlags(
  target: Page
): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
  try {
    const client = await target.createCDPSession();
    const history = (await client.send('Page.getNavigationHistory')) as {
      currentIndex?: number;
      entries?: unknown[];
    };
    await client.detach().catch(() => undefined);
    const current = history.currentIndex ?? 0;
    const length = history.entries?.length ?? 0;
    return { canGoBack: current > 0, canGoForward: current < length - 1 };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

async function isChallengePage(target: Page): Promise<boolean> {
  try {
    const title = (await target.title()).toLowerCase().trim();
    if (
      title.startsWith('um momento') ||
      title.startsWith('just a moment') ||
      title.startsWith('attention required') ||
      title.includes('checking your browser')
    ) {
      return true;
    }
    const text = (await target.evaluate(
      'document.body ? document.body.innerText.slice(0, 700).toLowerCase() : ""'
    )) as string;
    return (
      text.includes('verificação de segurança') ||
      text.includes('verificacao de seguranca') ||
      text.includes('checking your browser before accessing') ||
      text.includes('just a moment...') ||
      text.includes('enable javascript and cookies') ||
      text.includes('cf-browser-verification') ||
      text.includes('ray id:')
    );
  } catch {
    return false;
  }
}

export interface LiveRenderOptions {
  url: string;
  /** Expressão JS que precisa ser verdadeira antes de extrair. */
  readyExpression: string;
  /** Expressão JS cujo resultado será convertido em JSON. */
  expression: string;
  timeoutMs?: number;
  pollMs?: number;
  /** Usa o host móvel (m.webnovel.com) e user-agent móvel. */
  mobile?: boolean;
  /** Tempo para o desafio do Cloudflare se resolver sozinho antes de limpar cookies. */
  challengeGraceMs?: number;
  /** Retorna true para interromper a extração (ex.: download cancelado). */
  shouldAbort?: () => boolean;
  /** Se a página já estiver na mesma URL, extrai sem navegar de novo. */
  reuseCurrentPage?: boolean;
}

function mobileUserAgent(): string {
  const match = /Chrome\/([\d.]+)/.exec(process.env.HUB_BROWSER_UA ?? '');
  const version = match?.[1] ?? '144.0.7559.236';
  return `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
}

export const MOBILE_USER_AGENT = mobileUserAgent();

function sameDocument(actual: string, wanted: string): boolean {
  try {
    const a = new URL(actual);
    const b = new URL(wanted);
    return a.host === b.host && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

async function renderOnPage<T>(
  target: Page,
  options: LiveRenderOptions,
  url: string,
  timeoutMs: number,
  pollMs: number
): Promise<{ data: T | null; title: string; finalUrl: string; bodyText: string }> {
  target.setDefaultNavigationTimeout(timeoutMs);
  if (!(options.reuseCurrentPage && sameDocument(target.url(), url))) {
    try {
      await target.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (error) {
      log.warn(
        `extração live lenta/falhou: ${url} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  const checkReady = async (): Promise<boolean> => {
    try {
      return (await target.evaluate(`Boolean(${options.readyExpression})`)) === true;
    } catch {
      return false;
    }
  };

  const ensureNotAborted = (): void => {
    if (options.shouldAbort?.()) {
      throw new Error('leitura pausada para verificação manual');
    }
  };

  // Deixa o desafio do Cloudflare resolver sozinho por alguns segundos.
  const graceMs = Math.min(options.challengeGraceMs ?? 6000, timeoutMs);
  const graceDeadline = Date.now() + graceMs;
  let ready = false;
  while (Date.now() < graceDeadline) {
    ensureNotAborted();
    ready = await checkReady();
    if (ready) break;
    await delay(pollMs);
  }

  // Ainda bloqueado: limpa somente os cookies do Cloudflare e reabre.
  if (!ready && (await isChallengePage(target))) {
    await clearCloudflareCookies(target);
    try {
      await target.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch {
      // segue para a espera principal
    }
    await delay(1000);
  }

  const deadline = Date.now() + timeoutMs;
  while (!ready && Date.now() < deadline) {
    ensureNotAborted();
    ready = await checkReady();
    if (ready) break;
    await delay(pollMs);
  }
  ensureNotAborted();
  if (!ready) {
    throw new Error('O site não terminou de carregar dentro do tempo esperado.');
  }

  await delay(300);
  const data = (await target.evaluate(`JSON.stringify(${options.expression})`)) as string;
  const meta = (await target.evaluate(
    `JSON.stringify({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 500) : '' })`
  )) as string;
  const metaValue = JSON.parse(meta || '{}') as {
    title?: string;
    url?: string;
    text?: string;
  };

  return {
    data: data ? (JSON.parse(data) as T) : null,
    title: metaValue.title ?? '',
    finalUrl: metaValue.url ?? url,
    bodyText: metaValue.text ?? ''
  };
}

/**
 * Extrai dados de uma página usando a janela "live" (a mesma que o navegador
 * auxiliar usa e que passa pela verificação da Webnovel).
 */
export async function liveRenderJson<T>(
  options: LiveRenderOptions
): Promise<{ data: T | null; title: string; finalUrl: string; bodyText: string }> {
  return enqueue(async () => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollMs = options.pollMs ?? 400;
    const canonical = canonicalizeWebnovelUrl(options.url);
    const url = options.mobile ? toMobileUrl(canonical) : canonical;

    const target = await ensurePage();
    touch();
    if (options.mobile) {
      // Usa a janela live com UA móvel e restaura o desktop depois.
      const host = await ensureBrowserHost();
      await target.setUserAgent(MOBILE_USER_AGENT);
      try {
        return await renderOnPage<T>(target, options, url, timeoutMs, pollMs);
      } finally {
        await target
          .setUserAgent(await browserUserAgent(host))
          .catch(() => undefined);
      }
    }
    return renderOnPage<T>(target, options, url, timeoutMs, pollMs);
  });
}

/** Remove os cookies do Cloudflare mantendo login/sessão do site. */
async function clearCloudflareCookies(target: Page): Promise<void> {
  try {
    const cookies = await target.cookies();
    const cf = cookies.filter(
      (cookie) => cookie.name === 'cf_clearance' || cookie.name === '__cf_bm'
    );
    if (cf.length > 0) await target.deleteCookie(...cf);
  } catch {
    // Sem cookies acessíveis.
  }
}

/**
 * A Webnovel marca páginas de livro com um desafio quando os cookies do
 * Cloudflare vieram da home. Limpar só esses cookies e reabrir a URL canônica
 * resolve, sem perder o login.
 */
async function recoverWebnovelChallenge(target: Page): Promise<void> {
  if (!(await isChallengePage(target))) return;
  if (!isWebnovelUrl(target.url())) return;

  const canonical = canonicalizeWebnovelUrl(target.url());
  await clearCloudflareCookies(target);
  try {
    await target.goto(canonical, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    // A captura seguinte mostra o estado atual.
  }
  await delay(1000);
}

async function capture(target: Page): Promise<LiveBrowserState> {
  let screenshot: string | null = null;
  try {
    screenshot = await target.screenshot({
      type: 'jpeg',
      quality: 62,
      captureBeyondViewport: false,
      encoding: 'base64'
    });
  } catch {
    // Mantém a última captura disponível.
  }
  const [title, flags] = await Promise.all([
    target.title().catch(() => ''),
    historyFlags(target)
  ]);
  lastState = {
    url: target.url(),
    title,
    screenshot: screenshot ?? lastState.screenshot,
    ...flags
  };
  return lastState;
}

/** Script já injetado na janela do host; evita empilhar duplicatas. */
let stealthHostKey: number | null = null;

async function ensurePage(): Promise<Page> {
  if (browser?.connected && page && !page.isClosed()) return page;

  const host = await ensureBrowserHost();
  browser = await puppeteer.connect({
    browserWSEndpoint: host.wsEndpoint,
    defaultViewport: VIEWPORT
  });

  // A janela fixa #hub-live é criada pelo host; não abrimos janela nova.
  const pages = await browser.pages();
  const target = pages.find((candidate) => candidate.url().includes('#hub-live')) ?? pages[0];
  if (!target) {
    await browser.disconnect().catch(() => undefined);
    browser = null;
    throw new Error('A janela do navegador auxiliar não está disponível.');
  }
  page = target;

  await page.setViewport(VIEWPORT);
  await page.setUserAgent(await browserUserAgent(host));
  if (stealthHostKey !== host.restartKey) {
    await page.evaluateOnNewDocument(STEALTH_SCRIPT);
    stealthHostKey = host.restartKey;
  }
  page.setDefaultNavigationTimeout(30_000);
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => undefined);
  });

  browser.on('disconnected', () => {
    browser = null;
    page = null;
  });

  log.info('navegador auxiliar conectado');
  return page;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function liveNavigate(url: string): Promise<LiveBrowserState> {
  return enqueue(async () => {
    const canonical = canonicalizeWebnovelUrl(url);
    const target = await ensurePage();
    touch();

    if (isWebnovelUrl(canonical)) {
      await clearCloudflareCookies(target);
    }

    try {
      await target.goto(canonical, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) {
      log.warn(`navegação lenta/falhou: ${canonical} (${error instanceof Error ? error.message : String(error)})`);
    }
    await delay(700);
    await recoverWebnovelChallenge(target);
    return capture(target);
  });
}

export async function liveAction(action: LiveBrowserAction): Promise<LiveBrowserState> {
  return enqueue(async () => {
    const target = await ensurePage();
    touch();
    try {
      if (action === 'back') {
        await target.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      } else if (action === 'forward') {
        await target.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      } else {
        await target.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
    } catch (error) {
      log.warn(
        `${action} falhou (${error instanceof Error ? error.message : String(error)})`
      );
    }
    await delay(500);
    await recoverWebnovelChallenge(target);
    return capture(target);
  });
}

export async function liveInput(input: LiveBrowserInput): Promise<LiveBrowserState> {
  return enqueue(async () => {
    const target = await ensurePage();
    touch();

    if (input.type === 'click') {
      const x = clamp(input.x, 0, VIEWPORT.width - 1);
      const y = clamp(input.y, 0, VIEWPORT.height - 1);
      if (isWebnovelUrl(target.url())) await clearCloudflareCookies(target);
      await target.mouse.click(x, y);
      await delay(900);
    } else if (input.type === 'scroll') {
      const x = clamp(input.x, 0, VIEWPORT.width - 1);
      const y = clamp(input.y, 0, VIEWPORT.height - 1);
      await target.mouse.move(x, y);
      await target.mouse.wheel({ deltaY: input.deltaY });
      await delay(250);
    } else if (input.type === 'key') {
      await target.keyboard.press(input.key as Parameters<typeof target.keyboard.press>[0]);
      await delay(150);
    } else {
      await target.keyboard.type(input.text, { delay: 15 });
      await delay(150);
    }

    await recoverWebnovelChallenge(target);
    return capture(target);
  });
}

export async function liveFrame(): Promise<LiveBrowserState> {
  return enqueue(async () => {
    if (!browser?.connected || !page || page.isClosed()) {
      throw new Error('O navegador real não está ativo.');
    }
    touch();
    return capture(page);
  });
}

export async function stopLiveBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const currentBrowser = browser;
  const currentPage = page;
  browser = null;
  page = null;

  // Volta a janela para o estado inicial, liberando a página sem fechar o host.
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .goto('about:blank#hub-live', { waitUntil: 'domcontentloaded', timeout: 5_000 })
      .catch(() => undefined);
  }
  // O host continua vivo para o scraping; apenas desconectamos o cliente.
  await currentBrowser?.disconnect().catch(() => undefined);
  if (currentBrowser) log.info('navegador auxiliar liberado');
}

/** Limpa cookies/cache do navegador sem reiniciar o app. */
export async function resetLiveBrowser(): Promise<void> {
  const target = await ensurePage();
  try {
    const client = await target.createCDPSession();
    await client.send('Network.clearBrowserCookies').catch(() => undefined);
    await client.send('Network.clearBrowserCache').catch(() => undefined);
    await client.detach().catch(() => undefined);
    await target
      .goto('about:blank#hub-live', { waitUntil: 'domcontentloaded', timeout: 10_000 })
      .catch(() => undefined);
  } finally {
    await stopLiveBrowser();
  }
}
