/**
 * Tentativa rápida de capítulo por HTML puro (sem navegador).
 *
 * Sites que renderizam o capítulo no servidor respondem em poucos
 * milissegundos. Páginas com desafio/JS caem rapidamente para as próximas
 * tentativas da cadeia.
 */
import { decodeEntities } from '../connectors/util';
import { isNovelChallengePage, isNovelUnavailablePage } from './webnovel-url';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const MAX_HTML_BYTES = 4 * 1024 * 1024;

export interface HtmlChapter {
  title: string;
  text: string;
  finalUrl: string;
}

function extractTitle(html: string): string {
  const title =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
    '';
  return decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300);
}

function findLongText(value: unknown, depth = 0): string {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return value.length > 400 ? value : '';
  if (Array.isArray(value)) {
    let best = '';
    for (const item of value) {
      const found = findLongText(item, depth + 1);
      if (found.length > best.length) best = found;
    }
    return best;
  }
  if (typeof value === 'object') {
    let best = '';
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!/content|text|body|chapter|article/i.test(key)) continue;
      const found = findLongText(item, depth + 1);
      if (found.length > best.length) best = found;
    }
    return best;
  }
  return '';
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h\d|li|blockquote|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractContent(html: string): string {
  const container =
    /<(div|article|section)[^>]*(?:class|id)=["'][^"']*(?:cha-words|cha-content|chapter-content|chapterContent|chapter-body|entry-content|post-content|read-content|reading-content|article-content|content-area)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(
      html
    ) ?? /<div[^>]*id=["']chapterContent["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (container) return container[2] ?? container[1] ?? '';

  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const data = JSON.parse(match[1] ?? '') as Record<string, unknown>;
      const body = [data.articleBody, data.text, data.description].find(
        (value): value is string => typeof value === 'string' && value.length > 200
      );
      if (body) return body;
    } catch {
      // JSON-LD inválido
    }
  }

  const nextData = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (nextData?.[1]) {
    try {
      const found = findLongText(JSON.parse(nextData[1]));
      if (found) return found;
    } catch {
      // JSON inválido
    }
  }

  return '';
}

export async function fetchNovelChapterHtml(
  url: string,
  timeoutMs = 5_000
): Promise<HtmlChapter | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  if (html.length < 500) return null;
  return extractChapterFromHtml(html, response.url || url);
}

/** Extrai um capítulo de HTML já baixado (também usado nos testes). */
export function extractChapterFromHtml(html: string, finalUrl = ''): HtmlChapter | null {
  const title = extractTitle(html);
  const content = extractContent(html);
  if (!content) return null;

  const text = htmlToText(content);
  if (text.length < 200) return null;
  if (isNovelChallengePage(title, text) || isNovelUnavailablePage(title, text)) {
    return null;
  }

  return { title: title || 'Capítulo', text, finalUrl };
}
