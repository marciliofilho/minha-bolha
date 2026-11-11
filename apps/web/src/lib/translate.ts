/** Tradução de textos curtos (sinopses) com cache local. */
import { api } from './api';

const CACHE_KEY = 'hub.translate.texts.v2';
const CACHE_MAX = 200;

interface CacheEntry {
  language: string;
  source: string;
  translated: string;
}

function hash(value: string): string {
  let hashValue = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 0x01000193);
  }
  return (hashValue >>> 0).toString(36);
}

function cacheKey(language: string, text: string): string {
  return `${language}:${hash(text)}`;
}

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, entry: CacheEntry): void {
  try {
    const cache = readCache();
    cache[key] = entry;
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      for (const oldKey of keys.slice(0, keys.length - CACHE_MAX)) {
        delete cache[oldKey];
      }
    }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cota cheia ou armazenamento indisponível.
  }
}

export async function translateText(
  text: string,
  language: string
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || !language) return text;

  const key = cacheKey(language, trimmed);
  const stored = readCache()[key];
  if (stored && stored.source === trimmed && stored.language === language) {
    return stored.translated;
  }

  const result = await api.translate({ text: trimmed, target: language });
  writeCache(key, {
    language,
    source: trimmed,
    translated: result.text
  });
  return result.text;
}
