/**
 * Extrator genérico de novels.
 *
 * Cada site tem um layout diferente. Em vez de manter dezenas de seletores,
 * abrimos a página em um navegador headless e combinamos JSON-LD, Open Graph,
 * a lista de capítulos visível e heurísticas de data. A Webnovel continua com
 * o extrator dedicado em `webnovel.ts`.
 */
import { ConnectorError } from './types';
import type { NovelChapter, NovelSnapshot } from './novel-types';
import { renderPageJson } from '../lib/headless-browser';
import { shortHash, stripHtml } from './util';

interface RawGenericChapter {
  url?: string;
  index?: number | null;
  name?: string;
  dateText?: string | null;
}

interface RawGenericNovel {
  title?: string | null;
  author?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  category?: string | null;
  tags?: string[];
  siteName?: string | null;
  bookUrl?: string | null;
  chaptersUrl?: string | null;
  pageUrls?: string[];
  lastUpdatedText?: string | null;
  latest?: RawGenericChapter | null;
  chapters?: RawGenericChapter[];
}

const READY_EXPRESSION = `
  document.readyState === 'complete' &&
  !/just a moment|um momento|enable javascript|verifica[cç][aã]o de seguran[cç]a/i.test(document.title || '') &&
  Boolean(document.querySelector('h1') || document.querySelector('meta[property="og:title"]'))
`;

const PREPARE_EXPRESSION = `(() => {
  const links = [...document.querySelectorAll('a[href]')];
  const count = links.filter((a) => /(chapter|cap[ií]tulo)/i.test((a.textContent || '') + ' ' + (a.getAttribute('href') || ''))).length;
  if (count > 3) return false;
  const target = [...document.querySelectorAll('button, a')].find((el) =>
    /^(chapters|chapter list|table of contents|índice|indice|cap[ií]tulos|sumário|sumario)$/i.test((el.textContent || '').replace(/\\s+/g, ' ').trim())
  );
  if (!target) return false;
  target.click();
  return true;
})()`;

const EXTRACT_EXPRESSION = `(() => {
  const textOf = (el) => (el && el.textContent ? el.textContent.replace(/\\s+/g, ' ').trim() : '');
  const abs = (href) => { try { return new URL(href, location.href).href; } catch { return null; } };
  const meta = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = el && (el.getAttribute('content') || el.getAttribute('href'));
      if (value) return value;
    }
    return null;
  };

  const nodes = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object') return;
    nodes.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (value.mainEntity) visit(value.mainEntity);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent || 'null')); } catch {}
  }
  const typeOf = (node) => {
    const t = node && node['@type'];
    return Array.isArray(t) ? t.join(' ') : String(t || '');
  };
  const book = nodes.find((node) => /Book|Novel|CreativeWork|ComicStory/i.test(typeOf(node)) && (node.name || node.headline)) || null;
  const valueText = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      const parts = value.map(valueText).filter(Boolean);
      return parts.length ? parts.join(', ') : null;
    }
    if (typeof value === 'object') return valueText(value.name || value['@id'] || value.url || null);
    return null;
  };
  const imageText = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return imageText(value[0]);
    if (typeof value === 'object') return imageText(value.url || value.contentUrl || value['@id'] || null);
    return null;
  };

  let title =
    (book && valueText(book.name || book.headline)) ||
    meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    textOf(document.querySelector('h1')) ||
    (document.title || '').replace(/\\s*[-|–—].*$/, '').trim() ||
    null;
  const h1Title = textOf(document.querySelector('h1'));
  if (title && h1Title && h1Title.length > 3 && title.toLowerCase().startsWith(h1Title.toLowerCase())) {
    title = h1Title;
  }
  const synopsis = (() => {
    const selectors = [
      '[itemprop="description"]',
      '.summary',
      '.description',
      '.book-description',
      '.book-detail',
      '.expand-wrapper',
      '.content'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = textOf(el);
      const cleaned = text
        ? text
            .replace(
              /^\s*(?:summary|synopsis|description|sinopse|descri[cç][aã]o)\s*[:\-]?\s*/i,
              ''
            )
            .trim()
        : '';
      if (
        cleaned &&
        cleaned.length > 80 &&
        cleaned.length < 5000 &&
        !/chapter\\s*list|table of contents|latest chapters?/i.test(cleaned)
      ) {
        return cleaned;
      }
    }
    return null;
  })();
  const description =
    synopsis ||
    (book && valueText(book.description)) ||
    meta(['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']) ||
    null;
  const metaAuthor = meta(['meta[name="author"]', 'meta[property="book:author"]']);
  const textAuthor = (() => {
    const bodyText = document.body ? document.body.innerText || '' : '';
    const match = /(?:^|\\n)\\s*(?:author|autor)\\s*[:\\-]\\s*([^\\n]{1,120})/i.exec(bodyText);
    if (!match) return null;
    const cleaned = match[1]
      .replace(/\\s*(?:genre|g[eê]nero|status|source|tags|publisher|translator|chapters|cap[ií]tulos|rank|views)\\b[\\s\\S]*$/i, '')
      .trim();
    if (!cleaned || /\\b(?:chapters?|ongoing|completed)\\b/i.test(cleaned)) return null;
    return cleaned;
  })();
  const domAuthor = (() => {
    const el = [...document.querySelectorAll('[itemprop="author"], [rel="author"], .author, .info-author, .book-author, .novel-author, a[href*="/author/"], a[href*="/authors/"]')]
      .find((item) => textOf(item) && !/more-from-author/i.test(String(item.className || '')));
    if (!el) return null;
    const value = textOf(el).replace(/^(?:author|autor|by|por)\\s*[:\\-]?\\s*/i, '').trim();
    if (!value || /\\b(?:chapters?|ongoing|completed)\\b/i.test(value)) return null;
    return value;
  })();
  const author =
    (book && valueText(book.author)) ||
    textAuthor ||
    (metaAuthor && !/^(?:novel\\s*fire|webnovel|readnovelfull|royal\\s*road|wuxiaworld|scribble\\s*hub|novelbin|admin|staff)$/i.test(metaAuthor.trim())
      ? metaAuthor.trim()
      : null) ||
    domAuthor;
  const genreValue = book ? book.genre : null;
  const jsonTags = (Array.isArray(genreValue) ? genreValue : genreValue ? [genreValue] : [])
    .map(valueText)
    .filter((tag) => Boolean(tag) && !/^https?:\\/\\//i.test(tag))
    .slice(0, 12);
  const bodyText = document.body ? document.body.innerText || '' : '';
  const genreMatch = /(?:^|\\n)\\s*(?:genre|g[eê]nero)\\s*[:\\-]\\s*([^\\n]{1,220})/i.exec(bodyText);
  const textTags = genreMatch
    ? genreMatch[1].split(/[,/|]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
    : [];
  const tags = jsonTags.length > 0 ? jsonTags : textTags;
  const chapterListUrl =
    [...document.querySelectorAll('a[href]')]
      .map((anchor) => abs(anchor.getAttribute('href')))
      .find((href) => Boolean(href) && /\\/chapters?(?:\\/)?(?:[?#]|$)/i.test(href || '')) || null;

  const pageUrls = [...new Set(
    [...document.querySelectorAll('.pagination a[href], .page-link[href], a[rel="next"][href]')]
      .map((anchor) => abs(anchor.getAttribute('href')))
      .filter(Boolean)
  )];

  const pageBodyText = document.body ? document.body.innerText || '' : '';
  const releaseText = /release date[^\\n]{0,180}/i.exec(pageBodyText)?.[0] || '';
  const updatedText = /(?:updated|last updated|atualizado|última atualização)[^\\n]{0,140}/i.exec(pageBodyText)?.[0] || '';
  const lastUpdatedText = [releaseText, updatedText].filter(Boolean).join(' ') || null;

  let coverUrl =
    meta(['meta[property="og:image"]', 'meta[name="twitter:image"]']) ||
    imageText(book && book.image) ||
    null;
  if (!coverUrl) {
    const images = [...document.querySelectorAll('img')]
      .map((img) => ({
        src: abs(img.currentSrc || img.src || ''),
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0
      }))
      .filter((item) => item.src);
    const portrait = images.find((item) => item.h > item.w * 1.1 && item.w >= 120);
    const large = images.find((item) => item.w >= 300);
    coverUrl = (portrait || large || images[0] || {}).src || null;
  }
  coverUrl = abs(coverUrl);

  const cleanName = (label, index) => {
    let value = (label || '').replace(/\\s+/g, ' ').trim();
    value = value.replace(/^(?:novel|latest|new|recent)\\s+chapters?\\s*[:\\-–—]?\\s*/i, '');
    value = value.replace(/^\\s*\\d+(?:\\.\\d+)?\\s*[.):\\-–—]\\s*/, '');
    value = value.replace(/^\\d+\\s*(?=(?:chapter|cap[ií]tulo|cap\\.?|chap\\.?|ch\\.?|epis[oó]dio|episode|part|volume|vol\\.?))/i, '');
    value = value.replace(/^(?:chapter|cap[ií]tulo|cap\\.?|chap\\.?|ch\\.?|epis[oó]dio|episode|ep\\.?|part|volume|vol\\.?)\\s*[#:.\\-–—]*\\s*\\d+(?:[.,]\\d+)?\\s*[:\\-–—]?\\s*/i, '');
    value = value.replace(/^\\d+(?:\\.\\d+)?\\s*[:\\-–—]\\s*/, '');
    value = value.replace(/\\s+(?:updated|atualizado)\\s*$/i, '');
    value = value.replace(/\\s*(?:\\d+\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\s+ago|há\\s+\\d+.*|yesterday|today|ontem|hoje|\\d{4}-\\d{2}-\\d{2}.*|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}.*)$/i, '');
    value = value.trim();
    if (!value || /^(?:read|ler|continue|continuar|next|próximo|proximo)$/i.test(value)) {
      return 'Capítulo ' + index;
    }
    return value;
  };

  // Muitos sites expõem a lista completa em JSON (window.chapters, __NEXT_DATA__, etc.).
  // Isso é mais confiável do que ler apenas a tabela paginada do DOM.
  const roots = [];
  for (const key of ['chapters', 'chapterList', 'chapterData', '__CHAPTERS__', '__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', 'book', 'novel']) {
    const value = window[key];
    if (value) roots.push(value);
  }
  for (const script of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')) {
    try { roots.push(JSON.parse(script.textContent || 'null')); } catch {}
  }

  const looksLikeChapter = (item) => {
    if (!item || typeof item !== 'object') return false;
    const title = item.title || item.name || item.chapterTitle || item.chapter_title || item.chapterName;
    const url = item.url || item.href || item.link || item.path;
    if (typeof title !== 'string' || typeof url !== 'string' || !url.trim()) return false;
    return /(chapter|cap[ií]tulo|chapter|episode|epis[oó]dio|\\/read\\/|\\/ch\\/)/i.test(url + ' ' + title);
  };
  const arrays = [];
  const collect = (value, depth) => {
    if (!value || depth > 6 || arrays.length > 30) return;
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (value.length >= 2 && value.slice(0, 5).every(looksLikeChapter)) arrays.push(value);
      for (const item of value) collect(item, depth + 1);
      return;
    }
    if (value.nodeType) return;
    for (const key of Object.keys(value).slice(0, 80)) collect(value[key], depth + 1);
  };
  for (const root of roots) collect(root, 0);

  let embedded = null;
  for (const candidate of arrays) {
    if (!embedded || candidate.length > embedded.length) embedded = candidate;
  }

  const pickString = (item, keys) => {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  const pickNumber = (item, keys) => {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && /^\\d+(?:\\.\\d+)?$/.test(value.trim())) return Number(value.trim());
    }
    return null;
  };
  const pickDate = (item) => {
    for (const key of ['date', 'publishedAt', 'published_at', 'publishTime', 'publish_time', 'createdAt', 'created_at', 'updatedAt', 'updated_at', 'releaseDate', 'release_date', 'time']) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 10_000_000_000 ? value * 1000 : value;
        return new Date(ms).toISOString();
      }
    }
    return null;
  };

  if (embedded) {
    const hasOrder = embedded.every((item) => typeof item.order === 'number');
    const minOrder = hasOrder ? Math.min(...embedded.filter((item) => typeof item.order === 'number').map((item) => item.order)) : 0;
    const orderOffset = hasOrder && minOrder === 0 ? 1 : 0;
    const mapped = [];
    for (const item of embedded) {
      if (item.visible === 0 || item.hidden === true) continue;
      const rawTitle = pickString(item, ['title', 'name', 'chapterTitle', 'chapter_title', 'chapterName']);
      const rawUrl = pickString(item, ['url', 'href', 'link', 'path']);
      if (!rawTitle || !rawUrl) continue;
      const url = abs(rawUrl);
      if (!url) continue;
      try {
        if (new URL(url).hostname.replace(/^www\\./i, '') !== location.hostname.replace(/^www\\./i, '')) continue;
      } catch { continue; }
      const titleIndex = /^\\s*(\\d+(?:\\.\\d+)?)\\s*[.):\\-–—]\\s*/.exec(rawTitle)?.[1];
      const order = typeof item.order === 'number' ? item.order + orderOffset : null;
      const numeric = pickNumber(item, ['chapterNumber', 'chapterIndex', 'number', 'num', 'index', 'position']);
      const index = titleIndex ? Number(titleIndex) : numeric ?? order;
      mapped.push({
        url,
        index: index ?? null,
        name: cleanName(rawTitle, index ?? 0),
        dateText: pickDate(item),
        order: typeof item.order === 'number' ? item.order : mapped.length
      });
    }
    if (mapped.length >= 2) {
      const ordered = mapped.every((item) => typeof item.order === 'number');
      if (ordered) mapped.sort((a, b) => a.order - b.order);
      else if (mapped.some((item) => item.dateText)) mapped.sort((a, b) => String(a.dateText).localeCompare(String(b.dateText)));
      else mapped.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const chapters = mapped.map(({ url, index, name, dateText }) => ({ url, index, name, dateText }));
      return {
        title,
        author,
        description,
        coverUrl,
        category: tags[0] || null,
        tags,
        siteName: location.hostname.replace(/^www\\./i, ''),
        bookUrl: location.href,
        chaptersUrl: chapterListUrl,
        pageUrls,
        lastUpdatedText,
        latest: chapters[chapters.length - 1] || null,
        chapters
      };
    }
  }

  const chapterWord = /(cap[ií]tulo|chapter|chap\\.?|ch\\.?|epis[oó]dio|episode|part|volume|vol\\.?)/i;
  const numberAfter = /(?:cap[ií]tulo|chapter|chap\\.?|ch\\.?|epis[oó]dio|episode|part|volume|vol\\.?)\\s*[#:.\\-–—]*\\s*(\\d+(?:[.,]\\d+)?)/i;
  const hrefNumber = /(?:chapter|chapitre|capitulo|cap[ií]tulo|episode|episodio|\\/ch\\/|\\/c\\/|\\/read\\/)[-_\\s/]*?(\\d+(?:[.,]\\d+)?)/i;
  const readNumber = /\\/read\\/\\d+\\/(\\d+(?:[.,]\\d+)?)/i;
  const queryNumber = /(?:chapter|chap|ch|capitulo|cap)=([0-9]+)/i;
  const skip = /(\\bcomment\\b|\\breview\\b|\\bauthor\\b|\\bautor\\b|\\blogin\\b|\\bsign\\s*in\\b|\\bregister\\b|\\breport\\b|\\bshare\\b|\\bdownload\\b|\\bapp\\b|\\bprofile\\b|\\buser\\b|\\baccount\\b|\\bpolicy\\b|\\bprivacy\\b|\\bterms\\b|chapter-list|table-of-contents|\\bcatalog\\b|\\/chapters?(?:[\\/?#]|$)|\\bstart\\s*reading\\b|\\bread\\s*now\\b|\\bcomeçar\\b|\\bcomecar\\b|\\biniciar\\b|\\bbegin\\s*reading\\b)/i;
  const dateHint = /(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b|\\b(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\\b|\\b\\d+\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\s+ago\\b|\\b\\d+\\s*[smhdwy]\\s+ago\\b|há\\s+\\d+|\\b\\d+\\s*(?:segundo|minuto|hora|dia|semana|mês|mes|ano)s?\\s+atrás|\\b(?:yesterday|today|ontem|hoje)\\b)/i;
  const anchors = new Map();
  const pool = [];
  let order = 0;

  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = abs(anchor.getAttribute('href'));
    if (!href || !/^https?:/i.test(href)) continue;
    const label = textOf(anchor);
    if (!label || label.length > 220) continue;
    const titleAttr = anchor.getAttribute('title') || '';
    const combined = label + ' ' + titleAttr;
    const textMatch = numberAfter.exec(combined);
    const numberMatch = textMatch || readNumber.exec(href) || hrefNumber.exec(href) || queryNumber.exec(href);
    if (!numberMatch) continue;
    const strongText = chapterWord.test(combined);
    const strongHref = /(chapter|capitulo|cap[ií]tulo|episode|episodio|\\/ch\\/|\\/read\\/)/i.test(href);
    if (!strongText && !strongHref) continue;
    if (skip.test(href) || skip.test(label)) continue;
    const index = Number(numberMatch[1].replace(',', '.'));
    if (!Number.isFinite(index)) continue;
    // IDs internos costumam ter 5+ dígitos e não são o número do capítulo.
    if (!textMatch && index > 10_000) continue;

    const siteHost = new URL(href).hostname.replace(/^www\\./i, '');
    const sameHost = siteHost === location.hostname.replace(/^www\\./i, '');
    if (anchors.has(href)) {
      const existing = anchors.get(href);
      if (!existing.sameHost && sameHost) existing.sameHost = true;
      continue;
    }
    const row = anchor.closest('li, tr, article, [class*="chapter" i], [class*="row" i]') || anchor.parentElement;
    const rowText = row ? textOf(row).slice(0, 220) : '';
    const labelHasNumber = numberAfter.test(label);
    const rawLabel = labelHasNumber ? label : rowText || label;
    const item = { href, label: rawLabel, index, sameHost, order: order++, el: anchor };
    anchors.set(href, item);
    pool.push(item);
  }

  let usable = pool.filter((item) => item.sameHost);
  if (usable.length === 0) usable = pool;
  usable.sort((a, b) => (a.index - b.index) || (a.order - b.order));

  const dateTextFor = (item) => {
    const anchor = anchors.get(item.href);
    let node = anchor ? anchor.el : null;
    for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
      const dateEl = node.querySelector('time[datetime], [datetime], [data-time], [data-timestamp], [data-date], [data-published]');
      if (dateEl) {
        for (const attr of ['datetime', 'data-time', 'data-timestamp', 'data-date', 'data-published', 'title']) {
          const value = dateEl.getAttribute(attr);
          if (value && /\\d/.test(value)) return value;
        }
      }
      const title = node.getAttribute && node.getAttribute('title');
      if (title && dateHint.test(title)) return title;
      const t = textOf(node);
      if (t && t.length <= 300 && dateHint.test(t)) return t;
    }
    return null;
  };

  const latestHint = /latest\\s+(?:chapter|release|update)|new\\s+chapter|most\\s+recent|last\\s+chapter|último\\s+cap[ií]tulo|última\\s+atualiza[cç][aã]o|último\\s+lan[cç]amento/i;
  let latestHref = null;
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 3) continue;
    const t = textOf(el);
    if (!t || t.length > 70 || !latestHint.test(t)) continue;
    const container = el.closest('section, article, li, tr, div') || el.parentElement;
    const link = container && container.querySelector('a[href]');
    if (!link) continue;
    const href = abs(link.getAttribute('href'));
    if (href && anchors.has(href)) { latestHref = href; break; }
  }

  const latestItem = (latestHref && usable.find((item) => item.href === latestHref)) || usable[usable.length - 1] || null;

  // Datas apenas para os capítulos mais recentes (evita percorrer o DOM inteiro).
  const newest = [...usable].sort((a, b) => b.index - a.index).slice(0, 200);
  const dates = new Map();
  for (const item of newest) dates.set(item.href, dateTextFor(item));

  const chapters = usable.map((item) => ({
    url: item.href,
    index: item.index,
    name: cleanName(item.label, item.index),
    dateText: dates.get(item.href) || null
  }));

  const latest = latestItem
    ? {
        url: latestItem.href,
        index: latestItem.index,
        name: cleanName(latestItem.label, latestItem.index),
        dateText: dates.get(latestItem.href) || dateTextFor(latestItem)
      }
    : null;

  return {
    title,
    author,
    description,
    coverUrl,
    category: tags[0] || null,
    tags,
    siteName: location.hostname.replace(/^www\\./i, ''),
    bookUrl: location.href,
    chaptersUrl: chapterListUrl,
    pageUrls,
    lastUpdatedText,
    latest,
    chapters
  };
})()`;

function normalizeInputUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ConnectorError('config', 'Informe a página da novel.');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new ConnectorError('config', 'Cole a URL completa da página da novel.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('config', 'A URL precisa começar com http:// ou https://.');
  }
  url.hash = '';
  return url.toString();
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

const PT_MONTHS: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, março: 3, marco: 3,
  abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7,
  ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10,
  nov: 11, novembro: 11, dez: 12, dezembro: 12
};

function parseDateText(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const iso = /(\d{4}-\d{2}-\d{2}(?:[T ][\d:]{2,8}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)/.exec(text);
  if (iso?.[1]) {
    const date = new Date(iso[1]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const slash = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    if (day <= 31 && month <= 12 && year >= 2000) {
      const date = new Date(Date.UTC(year, month - 1, day, 12));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const ptDate = /(\d{1,2})\s+de\s+([a-zç]{3,})\s+de\s+(\d{4})/i.exec(text);
  if (ptDate) {
    const month = PT_MONTHS[ptDate[2].toLowerCase()];
    if (month) {
      const date = new Date(Date.UTC(Number(ptDate[3]), month - 1, Number(ptDate[1]), 12));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const enDate = /([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (enDate) {
    const month = EN_MONTHS[enDate[1].toLowerCase()];
    if (month) {
      const date = new Date(Date.UTC(Number(enDate[3]), month - 1, Number(enDate[2]), 12));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const relativeEn =
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text) ||
    /(\d+)\s*(s|m|h|d|w|mo|y)\s+ago/i.exec(text);
  if (relativeEn?.[1] && relativeEn[2]) {
    const amount = Number(relativeEn[1]);
    const unit = relativeEn[2].toLowerCase();
    const factor: Record<string, number> = {
      s: 1_000, second: 1_000, seconds: 1_000,
      m: 60_000, minute: 60_000, minutes: 60_000,
      h: 3_600_000, hour: 3_600_000, hours: 3_600_000,
      d: 86_400_000, day: 86_400_000, days: 86_400_000,
      w: 7 * 86_400_000, week: 7 * 86_400_000, weeks: 7 * 86_400_000,
      mo: 30 * 86_400_000, month: 30 * 86_400_000, months: 30 * 86_400_000,
      y: 365 * 86_400_000, year: 365 * 86_400_000, years: 365 * 86_400_000
    };
    return new Date(Date.now() - (factor[unit] ?? 86_400_000) * amount).toISOString();
  }

  const relativePt =
    /há\s+(\d+)\s*(segundo|minuto|hora|dia|semana|mês|mes|ano)/i.exec(text) ||
    /(\d+)\s*(segundo|minuto|hora|dia|semana|mês|mes|ano)s?\s+atrás/i.exec(text);
  if (relativePt?.[1] && relativePt[2]) {
    const amount = Number(relativePt[1]);
    const unit = relativePt[2].toLowerCase();
    const factor: Record<string, number> = {
      segundo: 1_000, segundos: 1_000,
      minuto: 60_000, minutos: 60_000,
      hora: 3_600_000, horas: 3_600_000,
      dia: 86_400_000, dias: 86_400_000,
      semana: 7 * 86_400_000, semanas: 7 * 86_400_000,
      mês: 30 * 86_400_000, mes: 30 * 86_400_000, meses: 30 * 86_400_000,
      ano: 365 * 86_400_000, anos: 365 * 86_400_000
    };
    return new Date(Date.now() - (factor[unit] ?? 86_400_000) * amount).toISOString();
  }

  if (/\bjust now\b|\bagora\b|^\s*today\b|^\s*hoje\b/i.test(text)) {
    return new Date().toISOString();
  }
  if (/\byesterday\b|\bontem\b/i.test(text)) {
    return new Date(Date.now() - 86_400_000).toISOString();
  }

  return null;
}

function toChapter(raw: RawGenericChapter): NovelChapter | null {
  if (!raw.url || typeof raw.index !== 'number' || !Number.isFinite(raw.index)) return null;
  const name = raw.name?.trim() || `Capítulo ${raw.index}`;
  const url = raw.url.trim();
  if (!url) return null;
  return {
    id: shortHash(url),
    index: raw.index,
    name,
    publishedAt: parseDateText(raw.dateText ?? null),
    isVip: false,
    url
  };
}

function mapRawChapters(data: RawGenericNovel): NovelChapter[] {
  return (data.chapters ?? [])
    .map(toChapter)
    .filter((chapter): chapter is NovelChapter => chapter !== null)
    .filter((chapter, index, all) => all.findIndex((item) => item.id === chapter.id) === index)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function mergeChapters(...lists: NovelChapter[][]): NovelChapter[] {
  const map = new Map<string, NovelChapter>();
  for (const list of lists) {
    for (const chapter of list) {
      if (!map.has(chapter.id)) map.set(chapter.id, chapter);
    }
  }
  return [...map.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function renderGenericPage(pageUrl: string) {
  return renderPageJson<RawGenericNovel>({
    url: pageUrl,
    readyExpression: READY_EXPRESSION,
    expression: EXTRACT_EXPRESSION,
    prepareExpression: PREPARE_EXPRESSION,
    prepareWaitMs: 1800,
    timeoutMs: 30_000
  });
}

export async function loadGenericNovelPage(input: string): Promise<NovelSnapshot> {
  const url = normalizeInputUrl(input);

  let first;
  try {
    first = await renderGenericPage(url);
  } catch (error) {
    throw new ConnectorError(
      'blocked',
      `O site não liberou a página: ${error instanceof Error ? error.message : 'falha no navegador.'}`
    );
  }

  const firstData = first.data;
  if (!firstData?.title) {
    throw new ConnectorError(
      'layout_changed',
      'A página abriu, mas não encontrei o título da novel. Confira se é a página principal da obra.'
    );
  }

  let chapterData: RawGenericNovel = firstData;
  let chapters = mapRawChapters(firstData);
  const latestIndex = firstData.latest?.index ?? 0;

  // Muitos sites deixam a lista completa em uma página separada (/chapters),
  // paginada. Buscamos as páginas extras quando a lista inicial está incompleta.
  if (
    firstData.chaptersUrl &&
    firstData.chaptersUrl !== url &&
    (chapters.length === 0 || chapters.length < latestIndex)
  ) {
    try {
      const listPage = await renderGenericPage(firstData.chaptersUrl);
      if (listPage.data) {
        const listChapters = mapRawChapters(listPage.data);
        if (listChapters.length > 0) {
          chapterData = listPage.data;
          chapters = mergeChapters(chapters, listChapters);
        }

        const pageUrls = [...new Set([
          ...(firstData.pageUrls ?? []),
          ...(listPage.data.pageUrls ?? [])
        ])].filter(
          (pageUrl) =>
            pageUrl !== url &&
            pageUrl !== firstData.chaptersUrl &&
            !/[?&]page=1(?:&|$)/i.test(pageUrl)
        );

        for (const pageUrl of pageUrls.slice(0, 30)) {
          try {
            const page = await renderGenericPage(pageUrl);
            if (page.data) chapters = mergeChapters(chapters, mapRawChapters(page.data));
          } catch {
            // Página de capítulos indisponível: mantém o que já foi lido.
          }
        }
      }
    } catch {
      // Se a página de capítulos falhar, mantemos a lista inicial.
    }
  }

  if (chapters.length === 0) {
    throw new ConnectorError(
      'layout_changed',
      'Não encontrei a lista de capítulos nesta página. Use a página principal da novel, não a página de um capítulo.'
    );
  }

  const latestFromPage =
    (firstData.latest ? toChapter(firstData.latest) : null) ??
    (chapterData.latest ? toChapter(chapterData.latest) : null);
  if (latestFromPage && !chapters.some((chapter) => chapter.id === latestFromPage.id)) {
    chapters.push(latestFromPage);
    chapters.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  let latestChapter =
    (latestFromPage && chapters.find((chapter) => chapter.id === latestFromPage.id)) ||
    latestFromPage ||
    chapters[chapters.length - 1] ||
    null;

  // Alguns sites não datam cada capítulo, mas informam "Updated ..." ou a
  // data do último lançamento no topo da página.
  const fallbackDate = parseDateText(chapterData.lastUpdatedText ?? firstData.lastUpdatedText ?? null);
  if (latestChapter && !latestChapter.publishedAt && fallbackDate) {
    const latestId = latestChapter.id;
    latestChapter = { ...latestChapter, publishedAt: fallbackDate };
    chapters = chapters.map((chapter) =>
      chapter.id === latestId ? { ...chapter, publishedAt: chapter.publishedAt ?? fallbackDate } : chapter
    );
  }

  // Alguns sites mostram só os últimos capítulos; o índice do mais recente
  // ajuda a estimar o total real (ex.: capítulo 1356 de uma lista parcial).
  const chapterCount = Math.max(
    chapters.length,
    latestChapter && latestChapter.index !== null ? Math.ceil(latestChapter.index) : 0
  );

  const bookUrl = (() => {
    try {
      const parsed = new URL(first.finalUrl || firstData.bookUrl || url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  })();

  return {
    provider: 'generic',
    bookId: shortHash(bookUrl),
    title: stripHtml(firstData.title).trim(),
    author: firstData.author
      ? stripHtml(firstData.author).trim() || null
      : chapterData.author
        ? stripHtml(chapterData.author).trim() || null
        : null,
    description: firstData.description
      ? stripHtml(firstData.description).trim() || null
      : chapterData.description
        ? stripHtml(chapterData.description).trim() || null
        : null,
    category: firstData.category
      ? stripHtml(firstData.category).trim() || null
      : chapterData.category
        ? stripHtml(chapterData.category).trim() || null
        : null,
    tags: (firstData.tags ?? []).length > 0
      ? firstData.tags!.map((tag) => stripHtml(tag).trim()).filter(Boolean)
      : (chapterData.tags ?? []).map((tag) => stripHtml(tag).trim()).filter(Boolean),
    chapterCount,
    coverUrl: firstData.coverUrl ?? chapterData.coverUrl ?? null,
    locale: null,
    bookUrl,
    siteName:
      firstData.siteName ??
      (() => {
        try {
          return new URL(bookUrl).hostname.replace(/^www\./i, '');
        } catch {
          return null;
        }
      })(),
    latestChapter,
    chapters
  };
}

/** Exposto para testes e para o endpoint de detalhes. */
export { parseDateText };
