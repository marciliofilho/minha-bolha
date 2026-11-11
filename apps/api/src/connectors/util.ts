/** Helpers de texto/HTML compartilhados entre conectores. */
import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”'
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Remove tags e normaliza espaços, para descrições seguras (texto puro). */
export function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  const withoutTags = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, max = 320): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Extrai a primeira imagem de um trecho de HTML. */
export function firstImageFromHtml(html: string | null | undefined, baseUrl?: string): string | null {
  if (!html) return null;
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (!match?.[1]) return null;
  return absoluteUrl(match[1], baseUrl);
}

export function absoluteUrl(value: string, baseUrl?: string): string | null {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Hash curto e estável usado em dedupe de links/guids. */
export function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 20);
}

export function safeIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/** Junta os inúmeros formatos possíveis de um nó de texto XML. */
export function xmlText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return xmlText(value[0]);
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (typeof node['#text'] === 'string') return node['#text'];
    if (typeof node.__text === 'string') return node.__text;
  }
  return '';
}
