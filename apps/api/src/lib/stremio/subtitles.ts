/**
 * Legendas de addons: nomes de idioma, download same-origin e conversão
 * SRT/ASS para WebVTT (o <track> do navegador só aceita VTT).
 */
import { assertAllowedAddonHost } from './addons/manifest';

const SUBTITLE_TIMEOUT_MS = 15_000;
const SUBTITLE_MAX_BYTES = 8 * 1024 * 1024;
const SUBTITLE_CACHE_TTL = 60 * 60_000;
const SUBTITLE_CACHE_MAX = 160;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const LANGUAGE_NAMES: Record<string, string> = {
  afr: 'Africâner',
  alb: 'Albanês',
  ara: 'Árabe',
  arm: 'Armênio',
  baq: 'Basco',
  ben: 'Bengali',
  bos: 'Bósnio',
  bre: 'Bretão',
  bul: 'Búlgaro',
  bur: 'Birmanês',
  cat: 'Catalão',
  chi: 'Chinês',
  zho: 'Chinês',
  cze: 'Tcheco',
  ces: 'Tcheco',
  dan: 'Dinamarquês',
  dut: 'Holandês',
  nld: 'Holandês',
  eng: 'Inglês',
  epo: 'Esperanto',
  est: 'Estoniano',
  fin: 'Finlandês',
  fre: 'Francês',
  fra: 'Francês',
  geo: 'Georgiano',
  kat: 'Georgiano',
  ger: 'Alemão',
  deu: 'Alemão',
  glg: 'Galego',
  gre: 'Grego',
  ell: 'Grego',
  heb: 'Hebraico',
  hin: 'Hindi',
  hrv: 'Croata',
  hun: 'Húngaro',
  ice: 'Islandês',
  isl: 'Islandês',
  ind: 'Indonésio',
  ita: 'Italiano',
  jpn: 'Japonês',
  kaz: 'Cazaque',
  khm: 'Khmer',
  kor: 'Coreano',
  lav: 'Letão',
  lit: 'Lituano',
  mac: 'Macedônio',
  mkd: 'Macedônio',
  may: 'Malaio',
  msa: 'Malaio',
  mal: 'Malaiala',
  mon: 'Mongol',
  nor: 'Norueguês',
  nob: 'Norueguês (Bokmål)',
  per: 'Persa',
  fas: 'Persa',
  pol: 'Polonês',
  pob: 'Português (Brasil)',
  por: 'Português',
  pt: 'Português',
  'pt-br': 'Português (Brasil)',
  'pt-pt': 'Português (Portugal)',
  rum: 'Romeno',
  ron: 'Romeno',
  rus: 'Russo',
  scc: 'Sérvio',
  srp: 'Sérvio',
  sin: 'Cingalês',
  slo: 'Eslovaco',
  slk: 'Eslovaco',
  slv: 'Esloveno',
  spa: 'Espanhol',
  swe: 'Sueco',
  tam: 'Tâmil',
  tel: 'Telugu',
  tha: 'Tailandês',
  tur: 'Turco',
  ukr: 'Ucraniano',
  urd: 'Urdu',
  vie: 'Vietnamita',
  wel: 'Galês',
  cym: 'Galês'
};

export function subtitleLanguageName(code: string): string {
  const normalized = code.trim().toLowerCase();
  return LANGUAGE_NAMES[normalized] ?? normalized.toUpperCase();
}

/** Ordem de preferência: português, inglês, espanhol e depois alfabética. */
export function subtitleLanguageRank(code: string): number {
  const normalized = code.trim().toLowerCase();
  if (normalized === 'pob' || normalized === 'por' || normalized === 'pt' || normalized.startsWith('pt-')) {
    return 0;
  }
  if (normalized === 'eng' || normalized === 'en') return 1;
  if (normalized === 'spa' || normalized === 'es') return 2;
  return 3;
}

function decodeWith(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Detecta BOM/charset e cai para Windows-1252 quando o UTF-8 tem lixo. */
export function decodeSubtitleBytes(buffer: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWith(bytes.slice(3), 'utf-8') ?? '';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWith(bytes.slice(2), 'utf-16le') ?? '';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWith(bytes.slice(2), 'utf-16be') ?? '';
  }

  const declared = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType ?? '')?.[1]?.trim();
  const charset = declared ? declared.toLowerCase() : 'utf-8';
  const normalizedCharset =
    charset === 'iso-8859-1' || charset === 'latin1' || charset === 'latin-1'
      ? 'windows-1252'
      : charset;

  const decoded = decodeWith(bytes, normalizedCharset);
  if (decoded) {
    if (normalizedCharset !== 'utf-8') return decoded;
    const replacements = (decoded.match(/\uFFFD/g) ?? []).length;
    if (replacements > 0 && replacements > decoded.length * 0.002) {
      return decodeWith(bytes, 'windows-1252') ?? decoded;
    }
    return decoded;
  }
  return decodeWith(bytes, 'windows-1252') ?? decodeWith(bytes, 'utf-8') ?? '';
}

function cleanCueText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/\\N/gi, '\n')
    .replace(/\\n/gi, '\n')
    .replace(/\\h/gi, ' ')
    .trim();
}

function normalizeTimestamp(value: string): string | null {
  const trimmed = value.trim().replace(',', '.');
  let match = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(trimmed);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${match[4].padEnd(3, '0').slice(0, 3)}`;
  }
  match = /^(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(trimmed);
  if (match) {
    return `00:${match[1].padStart(2, '0')}:${match[2]}.${match[3].padEnd(3, '0').slice(0, 3)}`;
  }
  return null;
}

function cueLine(raw: string): string | null {
  const line = raw.trim();
  if (!line || !line.includes('-->')) return null;
  const [startRaw, rest] = line.split('-->');
  const start = normalizeTimestamp(startRaw);
  if (!start) return null;
  const endMatch = /^\s*([\d:.,]+)\s*(.*)$/.exec(rest ?? '');
  if (!endMatch) return null;
  const end = normalizeTimestamp(endMatch[1]);
  if (!end) return null;
  return `${start} --> ${end}${endMatch[2] ? ` ${endMatch[2].trim()}` : ''}`;
}

function convertSrtToVtt(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const output: string[] = ['WEBVTT', ''];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    const timestampIndex = lines.findIndex((line) => line.includes('-->'));
    if (timestampIndex < 0) continue;
    const cue = cueLine(lines[timestampIndex]);
    if (!cue) continue;
    const payload = cleanCueText(lines.slice(timestampIndex + 1).join('\n'));
    if (!payload) continue;
    output.push(cue, payload, '');
  }

  return output.length > 2 ? output.join('\n') : 'WEBVTT\n\n';
}

function convertAssToVtt(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let fields: string[] = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const output: string[] = ['WEBVTT', ''];

  for (const line of lines) {
    const format = /^Format:\s*(.+)$/i.exec(line.trim());
    if (format) {
      fields = format[1].split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const body = line.replace(/^Dialogue:\s*/i, '');
    const parts: string[] = [];
    let remaining = body;
    for (let index = 0; index < fields.length - 1; index += 1) {
      const comma = remaining.indexOf(',');
      if (comma < 0) break;
      parts.push(remaining.slice(0, comma));
      remaining = remaining.slice(comma + 1);
    }
    parts.push(remaining);

    const start = normalizeTimestamp(parts[fields.indexOf('start')] ?? '');
    const end = normalizeTimestamp(parts[fields.indexOf('end')] ?? '');
    const payload = cleanCueText(parts[fields.indexOf('text')] ?? '');
    if (!start || !end || !payload) continue;
    output.push(`${start} --> ${end}`, payload, '');
  }

  return output.length > 2 ? output.join('\n') : 'WEBVTT\n\n';
}

/** Converte o corpo baixado para WebVTT (idempotente para VTT). */
export function toWebVtt(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return 'WEBVTT\n\n';
  if (/^WEBVTT(?:\s|$)/i.test(text)) return text.endsWith('\n') ? text : `${text}\n`;
  if (/^\[Script Info\]/im.test(text) || /^Dialogue:/im.test(text)) {
    return convertAssToVtt(text);
  }
  if (text.includes('-->')) return convertSrtToVtt(text);
  return 'WEBVTT\n\n';
}

interface CacheEntry {
  expiresAt: number;
  text: string;
}

const subtitleCache = new Map<string, CacheEntry>();

function cacheGet(url: string): string | null {
  const entry = subtitleCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    subtitleCache.delete(url);
    return null;
  }
  return entry.text;
}

function cacheSet(url: string, text: string): void {
  if (subtitleCache.size >= SUBTITLE_CACHE_MAX) {
    const oldest = subtitleCache.keys().next().value;
    if (oldest) subtitleCache.delete(oldest);
  }
  subtitleCache.set(url, { expiresAt: Date.now() + SUBTITLE_CACHE_TTL, text });
}

/** Ajusta a posição vertical das cues para o player (porcentagem a partir do topo). */
export function applyCueLine(vtt: string, linePercent: number): string {
  const line = Math.min(100, Math.max(0, Math.round(linePercent)));
  return vtt
    .split('\n')
    .map((text) => {
      if (!text.includes('-->')) return text;
      const cleaned = text
        .replace(/\s+line:\S+/gi, '')
        .replace(/\s+position:\S+/gi, '')
        .replace(/\s+align:\S+/gi, '')
        .trimEnd();
      return `${cleaned} line:${line}% align:center`;
    })
    .join('\n');
}

/** Baixa a legenda seguindo redirects validados e devolve WebVTT. */
export async function fetchSubtitleAsVtt(
  url: string,
  linePercent?: number | null
): Promise<string> {
  const cacheKey = linePercent === undefined || linePercent === null
    ? url
    : `${url}#line=${Math.round(linePercent)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error('URL de legenda inválida.');
  }

  for (let hop = 0; hop <= 3; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error('A legenda precisa usar http ou https.');
    }
    assertAllowedAddonHost(current);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(SUBTITLE_TIMEOUT_MS),
        headers: {
          accept: 'text/vtt, application/x-subrip, text/plain, */*;q=0.5',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
          'user-agent': USER_AGENT
        }
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new Error(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'O servidor de legendas demorou demais para responder.'
          : 'Não foi possível baixar a legenda.'
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === 3) throw new Error('A legenda redirecionou demais.');
      try {
        current = new URL(location, current);
      } catch {
        throw new Error('A legenda redirecionou para uma URL inválida.');
      }
      continue;
    }

    if (!response.ok) {
      throw new Error(`O servidor de legendas respondeu HTTP ${response.status}.`);
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > SUBTITLE_MAX_BYTES) throw new Error('O arquivo de legenda é grande demais.');

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > SUBTITLE_MAX_BYTES) throw new Error('O arquivo de legenda é grande demais.');

    const text = toWebVtt(decodeSubtitleBytes(buffer, response.headers.get('content-type')));
    if (!text.includes('-->')) {
      throw new Error('O addon devolveu uma legenda vazia ou em formato não suportado.');
    }
    const adjusted =
      linePercent === undefined || linePercent === null
        ? text
        : applyCueLine(text, linePercent);
    cacheSet(cacheKey, adjusted);
    return adjusted;
  }

  throw new Error('Não foi possível baixar a legenda.');
}
