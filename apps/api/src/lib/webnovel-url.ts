/**
 * Utilitários puros de URL e detecção de páginas de desafio da Webnovel.
 *
 * Ficam separados do navegador para poderem ser usados em testes e em rotas
 * sem carregar Puppeteer/Electron.
 */

/** Página de verificação (Cloudflare e similares) não é conteúdo de capítulo. */
export const NOVEL_CHALLENGE_RE =
  /(executando verifica[cç][aã]o de seguran[cç]a|verifica[cç][aã]o de seguran[cç]a|cf-browser-verification|just a moment\.\.\.|attention required!?\s*\|\s*cloudflare|checking your browser before accessing|enable javascript and cookies|ray id:)/i;

export function isWebnovelUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /(^|\.)webnovel\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * A Webnovel bloqueia URLs "bonitas" (com slug) no Cloudflare, mas libera a
 * URL canônica só com o ID numérico. Reescrevemos livros/capítulos para ela.
 */
export function canonicalizeWebnovelUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'webnovel.com') return url.toString();

    const locale =
      /^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i.exec(url.pathname)?.[1]?.toLowerCase() ?? 'pt';
    const match = /\/book\/(?:[^/]*_)?(\d{6,})(?:\/(?:[^/]*_)?(\d+))?/i.exec(url.pathname);
    if (!match?.[1]) return url.toString();

    const chapter = match[2] ? `/${match[2]}` : '';
    return `https://www.webnovel.com/${locale}/book/${match[1]}${chapter}`;
  } catch {
    return raw;
  }
}

export function toMobileUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (/(^|\.)webnovel\.com$/i.test(url.hostname)) {
      url.hostname = 'm.webnovel.com';
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/** Último segmento da URL (ID/slug do capítulo), para conferir a página. */
export function chapterSegment(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

export function isSameChapter(a: string, b: string): boolean {
  const left = chapterSegment(a);
  const right = chapterSegment(b);
  return Boolean(left && right && left === right);
}

export function isNovelChallengePage(title: string, text: string): boolean {
  // Só o começo da página: o texto do capítulo pode conter frases parecidas.
  const haystack = `${title}\n${text.slice(0, 1500)}`;
  return text.length < 20_000 && NOVEL_CHALLENGE_RE.test(haystack);
}
