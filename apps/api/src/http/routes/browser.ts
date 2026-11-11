/** Navegador do Feed: pré-checagem de iframe e proxy simplificado para sites protegidos. */
import { Router } from 'express';
import { HttpError } from '../errors';
import { renderPageJson } from '../../lib/headless-browser';
import {
  canonicalizeWebnovelUrl,
  hideLiveVerification,
  importLiveCookies,
  liveAction,
  liveFrame,
  liveInput,
  liveNavigate,
  resetLiveBrowser,
  showLiveVerification,
  stopLiveBrowser,
  type LiveBrowserInput
} from '../../lib/live-browser';

export const browserRouter = Router();

const CHECK_TIMEOUT_MS = 6_000;
const DIRECT_TIMEOUT_MS = 12_000;
const PROXY_CACHE_TTL_MS = 5 * 60_000;
const PROXY_CACHE_MAX = 16;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Hub/0.4';

interface BrowserCheckResult {
  url: string;
  embeddable: boolean;
  reason: string | null;
  status: number | null;
}

interface FetchedPage {
  html: string;
  finalUrl: string;
}

interface CachedPage extends FetchedPage {
  expiresAt: number;
}

const proxyCache = new Map<string, CachedPage>();

function parseTarget(raw: string): URL {
  if (!raw) throw new HttpError(400, 'Informe um endereço para abrir.', 'invalid_url');
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, 'Endereço inválido.', 'invalid_url');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, 'Use um endereço http:// ou https://.', 'invalid_url');
  }
  return target;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Detecta cabeçalhos que impedem a página de aparecer dentro de um iframe. */
function frameBlockReason(headers: Headers, status: number): string | null {
  const xfo = headers.get('x-frame-options')?.toLowerCase() ?? '';
  if (xfo.includes('deny')) {
    return 'Este site bloqueia ser exibido em outro site (X-Frame-Options: DENY).';
  }
  if (xfo.includes('sameorigin')) {
    return 'Este site só permite ser exibido no próprio domínio (X-Frame-Options: SAMEORIGIN).';
  }

  const csp = headers.get('content-security-policy') ?? '';
  const ancestors = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim().toLowerCase() ?? '';
  if (ancestors && ancestors !== '*') {
    if (ancestors === "'none'") {
      return 'Este site bloqueia ser exibido em outro site (frame-ancestors).';
    }
    const allowed = ancestors.split(/\s+/);
    const allowsHub = allowed.some(
      (value) =>
        value === '*' ||
        value.startsWith('http://127.0.0.1') ||
        value.startsWith('http://localhost')
    );
    if (!allowsHub) {
      return 'Este site limita em quais domínios pode ser exibido (frame-ancestors).';
    }
  }

  if (status >= 400) {
    return 'O site exige um navegador real ou bloqueou a verificação automática.';
  }
  return null;
}

function looksLikeChallenge(html: string): boolean {
  const sample = html.slice(0, 60_000).toLowerCase();
  return (
    sample.includes('cf-chl') ||
    sample.includes('challenge-platform') ||
    sample.includes('just a moment...') ||
    sample.includes('attention required! | cloudflare') ||
    sample.includes('enable javascript and cookies to continue')
  );
}

async function fetchDirect(target: URL): Promise<FetchedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const html = await response.text();
    if (looksLikeChallenge(html)) return null;
    return { html, finalUrl: response.url || target.toString() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHeadless(target: URL): Promise<FetchedPage | null> {
  try {
    const result = await renderPageJson<string>({
      url: target.toString(),
      readyExpression:
        'document.readyState === "complete" && document.body && document.body.innerText.length > 50',
      expression: 'document.documentElement.outerHTML',
      timeoutMs: 30_000
    });
    if (!result.data) return null;
    return { html: result.data, finalUrl: result.finalUrl || target.toString() };
  } catch {
    return null;
  }
}

async function fetchPage(target: URL, bypassCache: boolean): Promise<FetchedPage | null> {
  const cacheKey = target.toString();
  if (!bypassCache) {
    const cached = proxyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { html: cached.html, finalUrl: cached.finalUrl };
    }
  }

  const page = (await fetchDirect(target)) ?? (await fetchHeadless(target));
  if (!page) return null;

  if (proxyCache.size >= PROXY_CACHE_MAX) {
    const oldest = proxyCache.keys().next().value;
    if (oldest) proxyCache.delete(oldest);
  }
  proxyCache.set(cacheKey, { ...page, expiresAt: Date.now() + PROXY_CACHE_TTL_MS });
  return page;
}

function proxyHref(raw: string, baseUrl: string, proxyPrefix: string): string | null {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:')) {
    return null;
  }
  try {
    const absolute = new URL(value, baseUrl);
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;
    return `${proxyPrefix}?url=${encodeURIComponent(absolute.toString())}`;
  } catch {
    return null;
  }
}

/** Remove scripts e iframes e reescreve links para o proxy. */
function sanitizePage(html: string, baseUrl: string, proxyPrefix: string): string {
  let output = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/<base\b[^>]*>/gi, '');

  output = output.replace(/<a\b([^>]*)>/gi, (tag, attrs: string) => {
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (!hrefMatch) return tag;
    const raw = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
    const rewritten = proxyHref(raw, baseUrl, proxyPrefix);
    const nextAttrs = attrs.replace(
      /\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      rewritten ? `href="${escapeHtml(rewritten)}"` : 'href="#"'
    );
    return `<a${nextAttrs}>`;
  });

  const injected = [
    `<base href="${escapeHtml(baseUrl)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>img,video{max-width:100%;height:auto}html{-webkit-text-size-adjust:100%}</style>'
  ].join('');

  if (/<head\b[^>]*>/i.test(output)) {
    output = output.replace(/<head\b([^>]*)>/i, `<head$1>${injected}`);
  } else {
    output = `${injected}${output}`;
  }
  return output;
}

function errorPage(url: string, message: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1118;color:#e5e7eb;font-family:system-ui,sans-serif;padding:24px;text-align:center}
  h1{font-size:17px;margin:0 0 8px}p{font-size:13px;line-height:1.5;opacity:.75;margin:0;max-width:34rem}
  </style></head><body><div><h1>Não foi possível abrir este site</h1><p>${escapeHtml(message)}</p><p style="margin-top:12px;opacity:.55">${escapeHtml(url)}</p></div></body></html>`;
}

browserRouter.get('/browser/check', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const target = parseTarget(canonicalizeWebnovelUrl(raw));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    });
    const reason = frameBlockReason(response.headers, response.status);
    await response.body?.cancel().catch(() => undefined);
    const result: BrowserCheckResult = {
      url: response.url || target.toString(),
      embeddable: !reason,
      reason,
      status: response.status
    };
    res.json(result);
  } catch {
    // Sem resposta de pré-checagem: deixa o iframe tentar carregar.
    const result: BrowserCheckResult = {
      url: target.toString(),
      embeddable: true,
      reason: null,
      status: null
    };
    res.json(result);
  } finally {
    clearTimeout(timer);
  }
});

browserRouter.get('/browser/proxy', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const target = parseTarget(canonicalizeWebnovelUrl(raw));
  const bypassCache = req.query.refresh === '1';

  const page = await fetchPage(target, bypassCache);
  if (!page) {
    res
      .status(502)
      .type('html')
      .send(
        errorPage(
          target.toString(),
          'O site recusou a conexão, exige login ou usa uma proteção que não pôde ser contornada. Tente abrir em nova aba.'
        )
      );
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = `${req.protocol}://${req.get('host') ?? '127.0.0.1:4000'}`;
  const proxyPrefix = `${origin}/api/browser/proxy`;
  res.type('html').send(sanitizePage(page.html, page.finalUrl, proxyPrefix));
});

// ---------------------------------------------------------------------------
// Navegador real (Puppeteer/Chromium embutido)
// ---------------------------------------------------------------------------

browserRouter.post('/browser/live/navigate', async (req, res) => {
  const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const target = parseTarget(raw);
  res.json(await liveNavigate(target.toString()));
});

browserRouter.post('/browser/live/verify', async (req, res) => {
  const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const target = parseTarget(raw);
  res.json(await showLiveVerification(target.toString()));
});

browserRouter.post('/browser/live/verify/close', async (_req, res) => {
  await hideLiveVerification();
  res.json({ ok: true });
});

browserRouter.post('/browser/live/cookies', async (req, res) => {
  const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const target = parseTarget(raw);
  const cookies = Array.isArray(req.body?.cookies) ? req.body.cookies : [];
  res.json(await importLiveCookies(target.toString(), cookies));
});

browserRouter.post('/browser/live/action', async (req, res) => {
  const action = req.body?.action;
  if (action !== 'back' && action !== 'forward' && action !== 'reload') {
    throw new HttpError(400, 'Ação de navegação inválida.', 'invalid_action');
  }
  res.json(await liveAction(action));
});

browserRouter.post('/browser/live/input', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = body.type;
  let input: LiveBrowserInput;

  if (type === 'click') {
    const x = Number(body.x);
    const y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new HttpError(400, 'Coordenadas inválidas.', 'invalid_input');
    }
    input = { type: 'click', x, y };
  } else if (type === 'scroll') {
    const x = Number(body.x);
    const y = Number(body.y);
    const deltaY = Number(body.deltaY);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(deltaY)) {
      throw new HttpError(400, 'Rolagem inválida.', 'invalid_input');
    }
    input = { type: 'scroll', x, y, deltaY };
  } else if (type === 'key') {
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key || key.length > 20) {
      throw new HttpError(400, 'Tecla inválida.', 'invalid_input');
    }
    input = { type: 'key', key };
  } else if (type === 'text') {
    const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : '';
    if (!text) throw new HttpError(400, 'Texto vazio.', 'invalid_input');
    input = { type: 'text', text };
  } else {
    throw new HttpError(400, 'Entrada inválida.', 'invalid_input');
  }

  res.json(await liveInput(input));
});

browserRouter.get('/browser/live/frame', async (_req, res) => {
  try {
    res.json(await liveFrame());
  } catch {
    // Navegador real não está ativo (ex.: aba antiga ainda consultando).
    res.status(204).end();
  }
});

browserRouter.post('/browser/live/stop', async (_req, res) => {
  await stopLiveBrowser();
  res.json({ ok: true });
});

browserRouter.post('/browser/live/reset', async (_req, res) => {
  await resetLiveBrowser();
  res.json({ ok: true });
});
