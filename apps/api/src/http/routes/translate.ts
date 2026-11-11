/** Tradução de textos (sinopses e capítulos) via Google Translate público. */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseBody } from '../errors';

export const translateRouter = Router();

const ALLOWED_TARGETS = new Set([
  'pt',
  'en',
  'es',
  'fr',
  'de',
  'it',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW'
]);

const MAX_TEXT_LENGTH = 200_000;
const CHUNK_LENGTH = 4000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 300;
const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

interface CacheEntry {
  text: string;
  source: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const translateBodySchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  target: z.string().trim().min(2).max(10)
});

function cacheKey(text: string, target: string): string {
  return `${target}:${createHash('sha1').update(text).digest('hex')}`;
}

function readCache(text: string, target: string): CacheEntry | null {
  const key = cacheKey(text, target);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function writeCache(text: string, target: string, value: CacheEntry): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey(text, target), value);
}

function splitIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (normalized.length <= CHUNK_LENGTH) return [normalized];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
    if (paragraph.length > CHUNK_LENGTH) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      const words = paragraph.split(/\s+/);
      let part = '';
      for (const word of words) {
        if ((part + ' ' + word).trim().length > CHUNK_LENGTH) {
          chunks.push(part.trim());
          part = '';
        }
        part = `${part} ${word}`;
      }
      if (part.trim()) chunks.push(part.trim());
      continue;
    }
    if ((current + '\n\n' + paragraph).trim().length > CHUNK_LENGTH) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function parseGoogleSingle(payload: unknown): { text: string; source: string | null } | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const segments = payload[0] as unknown[];
  const text = segments
    .map((segment) =>
      Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''
    )
    .join('');
  if (!text.trim()) return null;
  const source = typeof payload[2] === 'string' ? payload[2] : null;
  return { text, source };
}

function parseGoogleDict(payload: unknown): { text: string; source: string | null } | null {
  // Formato: [["texto traduzido", "idioma de origem"], ...]
  if (!Array.isArray(payload)) return null;
  const text = payload
    .map((entry) =>
      Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : ''
    )
    .join('');
  if (!text.trim()) return null;
  const first = payload[0];
  const source = Array.isArray(first) && typeof first[1] === 'string' ? first[1] : null;
  return { text, source };
}

async function fetchGoogle(
  endpoint: string,
  rawText: string,
  target: string
): Promise<{ text: string; source: string | null }> {
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}sl=auto&tl=${encodeURIComponent(
    target
  )}&q=${encodeURIComponent(rawText)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      Accept: '*/*'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Google Translate respondeu ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  const parsed = endpoint.includes('dict-chrome-ex')
    ? parseGoogleDict(payload)
    : parseGoogleSingle(payload);
  if (!parsed) throw new Error('Resposta de tradução vazia.');
  return parsed;
}

async function translateChunk(
  text: string,
  target: string
): Promise<{ text: string; source: string | null }> {
  const endpoints = [
    `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t`,
    `https://clients5.google.com/translate_a/single?client=gtx&dt=t`,
    `https://clients5.google.com/translate_a/t?client=dict-chrome-ex`
  ];

  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      return await fetchGoogle(endpoint, text, target);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Não foi possível traduzir o texto.');
}

translateRouter.post('/translate', async (req, res) => {
  const body = parseBody(translateBodySchema, req.body);
  const target = body.target;
  if (!ALLOWED_TARGETS.has(target)) {
    throw new HttpError(400, 'Idioma de tradução não suportado.', 'validation');
  }

  const text = body.text.trim();
  if (!text) {
    res.json({ text: '', target, source: null });
    return;
  }

  const cached = readCache(text, target);
  if (cached) {
    res.json({ text: cached.text, target, source: cached.source });
    return;
  }

  const chunks = splitIntoChunks(text);
  try {
    const results: Array<{ text: string; source: string | null }> = [];
    for (const chunk of chunks) {
      results.push(await translateChunk(chunk, target));
    }
    const translated = results
      .map((result) => result.text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (!translated) throw new Error('A tradução retornou vazia.');

    const source = results.find((result) => result.source)?.source ?? null;
    writeCache(text, target, {
      text: translated,
      source,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
    res.json({ text: translated, target, source });
  } catch (error) {
    throw new HttpError(
      502,
      `Não foi possível traduzir agora. ${
        error instanceof Error ? error.message : String(error)
      }`,
      'translate'
    );
  }
});
