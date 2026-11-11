/**
 * Navegador auxiliar do app.
 *
 * Sobe o próprio Electron em um processo separado, com duas janelas ocultas
 * (live e scrape) e depuração remota em uma porta local. A API conversa com
 * essas janelas por CDP/Puppeteer, reaproveitando o Chromium já embutido no app
 * — nada de baixar ou instalar Chrome/Edge.
 *
 * As janelas usam `skipTaskbar` e ficam fora da área visível, então não criam
 * botão na barra de tarefas.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { env, repoRoot } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('browser-host');

const START_TIMEOUT_MS = 25_000;

/** Raiz do projeto; no app empacotado vem do processo principal. */
const appRoot = process.env.HUB_APP_ROOT?.trim() || repoRoot;

export type BrowserTargetKind = 'live' | 'scrape';

export interface BrowserHost {
  port: number;
  httpEndpoint: string;
  wsEndpoint: string;
  /** IDs das duas janelas fixas criadas pelo host. */
  targets: Record<BrowserTargetKind, string>;
  /** Porta/URLs mudam a cada reinício; guarda o processo para encerrar junto. */
  restartKey: number;
}

interface DevToolsVersion {
  Browser?: string;
  webSocketDebuggerUrl?: string;
}

interface DevToolsTarget {
  id: string;
  type: string;
  url: string;
}

let host: BrowserHost | null = null;
let child: ChildProcess | null = null;
let starting: Promise<BrowserHost> | null = null;
let hostUserAgent: string | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/** Caminho do executável do Electron disponível no projeto/app. */
function electronBinary(): string | null {
  const fromEnv = process.env.HUB_ELECTRON_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // API rodando dentro do Electron (ELECTRON_RUN_AS_NODE).
  if (process.versions.electron) return process.execPath;

  const candidates =
    process.platform === 'win32'
      ? ['node_modules/electron/dist/electron.exe']
      : process.platform === 'darwin'
        ? ['node_modules/electron/dist/Electron.app/Contents/MacOS/Electron']
        : ['node_modules/electron/dist/electron'];

  for (const candidate of candidates) {
    const full = resolve(appRoot, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function hostArgs(port: number): string[] {
  const args: string[] = [];
  if (process.env.HUB_PACKAGED !== '1') {
    args.push(resolve(appRoot, 'apps/desktop'));
  }
  args.push(`--browser-host=${port}`);
  return args;
}

function profileDir(): string {
  return process.env.HUB_BROWSER_PROFILE?.trim() || join(dirname(env.dbPath), 'browser-profile');
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolvePort(port) : reject(new Error('Sem porta livre.'))));
    });
  });
}

function killTree(processToKill: ChildProcess | null): void {
  if (!processToKill?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(processToKill.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    try {
      processToKill.kill('SIGKILL');
    } catch {
      // já encerrado
    }
  }
}

function buildUserAgent(version: DevToolsVersion): string {
  const browser = version.Browser ?? '';
  const edge = /Edg\/([\d.]+)/.exec(browser);
  const chrome = /Chrome\/([\d.]+)/.exec(browser);
  const full = edge?.[1] ?? chrome?.[1] ?? '140.0.0.0';
  const base =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${full} Safari/537.36`;
  return edge ? `${base} Edg/${full}` : base;
}

async function waitForHost(port: number, processToCheck: ChildProcess): Promise<{
  version: DevToolsVersion;
  targets: Record<BrowserTargetKind, string>;
}> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = '';

  while (Date.now() < deadline) {
    if (processToCheck.exitCode !== null) {
      throw new Error('O navegador auxiliar fechou antes de iniciar.');
    }
    try {
      const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
        response.json()
      )) as DevToolsVersion;
      const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json()
      )) as DevToolsTarget[];

      const pages = list.filter((target) => target.type === 'page');
      const live = pages.find((target) => target.url.includes('#hub-live'));
      const scrape = pages.find((target) => target.url.includes('#hub-scrape'));

      if (version.webSocketDebuggerUrl && live && scrape) {
        return {
          version,
          targets: { live: live.id, scrape: scrape.id }
        };
      }
      lastError = 'as janelas do navegador ainda não apareceram';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }

  throw new Error(`O navegador auxiliar não iniciou (${lastError}).`);
}

async function startHost(): Promise<BrowserHost> {
  const binary = electronBinary();
  if (!binary) {
    throw new Error(
      'Electron não encontrado para o navegador auxiliar. Defina HUB_ELECTRON_PATH.'
    );
  }

  const port = await freePort();
  const hostEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HUB_BROWSER_HOST: '1',
    HUB_BROWSER_PROFILE: profileDir(),
    HUB_PARENT_PID: String(process.pid)
  };
  // A API pode estar rodando como Node do Electron; o host precisa ser GUI.
  delete hostEnv.ELECTRON_RUN_AS_NODE;

  const spawned = spawn(binary, hostArgs(port), {
    cwd: process.env.HUB_APP_DIR?.trim() || appRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: hostEnv
  });
  child = spawned;

  let stderr = '';
  spawned.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stderr = `${stderr}${text}`.slice(-2000);
    if (process.env.HUB_BROWSER_DEBUG === '1') console.error(`[browser-host] ${text.trim()}`);
  });
  spawned.once('exit', (code, signal) => {
    if (host?.restartKey === port) {
      log.warn(`navegador auxiliar encerrou (código ${code ?? signal ?? '?'})`);
      host = null;
    }
    if (child === spawned) child = null;
  });

  try {
    const ready = await waitForHost(port, spawned);
    host = {
      port,
      httpEndpoint: `http://127.0.0.1:${port}`,
      wsEndpoint: ready.version.webSocketDebuggerUrl!,
      targets: ready.targets,
      restartKey: port
    };
    hostUserAgent = buildUserAgent(ready.version);
    log.info(`navegador auxiliar pronto na porta ${port}`);
    return host;
  } catch (error) {
    killTree(spawned);
    child = null;
    const detail = error instanceof Error ? error.message : String(error);
    const hint = stderr.trim() ? ` ${stderr.trim().split('\n').slice(-1)[0]}` : '';
    throw new Error(`${detail}${hint}`.trim());
  }
}

/** Garante o navegador auxiliar e devolve a porta/alvos atuais. */
export function ensureBrowserHost(): Promise<BrowserHost> {
  if (host) return Promise.resolve(host);
  if (!starting) {
    starting = startHost().finally(() => {
      starting = null;
    });
  }
  return starting;
}

/** Reinicia o processo (usado quando uma conexão CDP cai). */
export async function restartBrowserHost(): Promise<BrowserHost> {
  await stopBrowserHost();
  return ensureBrowserHost();
}

/** Encerra o navegador auxiliar; o host também morre sozinho se a API cair. */
export async function stopBrowserHost(): Promise<void> {
  const current = child;
  host = null;
  child = null;
  hostUserAgent = null;
  if (!current) return;

  killTree(current);
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(resolveStop, 1200);
    current.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

/** URL WebSocket de uma das janelas fixas. */
export function targetWebSocketUrl(current: BrowserHost, kind: BrowserTargetKind): string {
  return `ws://127.0.0.1:${current.port}/devtools/page/${current.targets[kind]}`;
}

/** User-agent sem marcas do Electron, para não ser bloqueado por anti-bot. */
export async function browserUserAgent(current: BrowserHost): Promise<string> {
  // O app desktop envia o UA exato usado no navegador do Feed; usar o mesmo
  // valor é essencial para os cookies de verificação valerem na extração.
  const fromEnv = process.env.HUB_BROWSER_UA?.trim();
  if (fromEnv) {
    hostUserAgent = fromEnv;
    return fromEnv;
  }
  if (hostUserAgent) return hostUserAgent;
  const version = (await fetch(`${current.httpEndpoint}/json/version`).then((response) =>
    response.json()
  )) as DevToolsVersion;
  hostUserAgent = buildUserAgent(version);
  return hostUserAgent;
}

process.once('exit', () => {
  killTree(child);
});
