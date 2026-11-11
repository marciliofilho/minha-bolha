/**
 * Link personalizado: acompanha uma página comum e cria um item no Feed
 * quando o conteúdo relevante muda. A extração usa o Chromium headless já
 * usado por novels/notícias, com fallback para metadados Open Graph.
 */
import { createHash } from 'node:crypto';
import type { ResolvedSourceDto, SettingsDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawItem } from './types';
import { ConnectorError } from './types';
import { renderPageJson } from '../lib/headless-browser';
import { assertPublicUrl } from '../lib/ssrf';
import { safeIso } from './util';

interface CustomPage {
  title: string | null;
  description: string | null;
  image: string | null;
  author: string | null;
  publishedAt: string | null;
  text: string;
}

interface CustomState {
  contentHash: string;
  title: string | null;
  description: string | null;
  image: string | null;
  checkedAt: string;
}

const CUSTOM_PAGE_EXTRACT = `(() => {
  const textOf = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const meta = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value =
        (el &&
          (el.getAttribute('content') ||
            el.getAttribute('datetime') ||
            el.getAttribute('href'))) ||
        null;
      if (value) return value.trim();
    }
    return null;
  };
  const abs = (value) => {
    if (!value) return null;
    try { return new URL(value, location.href).href; } catch { return null; }
  };
  const root =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;
  const text = (textOf(root) || '').replace(/\\s+/g, ' ').trim();
  const title =
    meta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    textOf(document.querySelector('h1')) ||
    document.title ||
    null;
  const description = meta([
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ]);
  const image = abs(meta([
    'meta[property="og:image"]',
    'meta[name="twitter:image"]'
  ]));
  const author = meta([
    'meta[name="author"]',
    'meta[property="article:author"]'
  ]);
  const publishedAt = meta([
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'time[datetime]'
  ]);
  return { title, description, image, author, publishedAt, text: text.slice(0, 12000) };
})()`;

function pageUrlFromConfig(config: Record<string, unknown>): string {
  const value = config.url ?? config.input;
  return typeof value === 'string' ? value.trim() : '';
}

function contentHash(page: CustomPage): string {
  const normalized = [page.title ?? '', page.description ?? '', page.text ?? '']
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1').update(normalized).digest('hex');
}

async function renderCustomPage(url: string): Promise<{
  finalUrl: string;
  page: CustomPage;
}> {
  const target = await assertPublicUrl(url);
  try {
    const result = await renderPageJson<CustomPage>({
      url: target.toString(),
      readyExpression:
        'document.readyState === "complete" && Boolean(document.title || document.querySelector("h1") || document.body)',
      expression: CUSTOM_PAGE_EXTRACT,
      timeoutMs: 45_000
    });
    if (!result.data) throw new Error('A página não devolveu dados.');
    const page = result.data;
    if (!page.title && !page.text) {
      throw new Error('Não encontrei título nem conteúdo nesta página.');
    }
    return { finalUrl: result.finalUrl || target.toString(), page };
  } catch (error) {
    throw new ConnectorError(
      'network',
      `Não foi possível ler a página. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function resolveCustom(input: string, _settings: SettingsDto): Promise<ResolvedSourceDto> {
  const withProtocol = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const { finalUrl, page } = await renderCustomPage(withProtocol);
  const title = page.title?.trim() || new URL(finalUrl).hostname.replace(/^www\./i, '');
  const now = new Date().toISOString();

  return {
    name: title.slice(0, 120),
    categoryId: 'other',
    config: {
      url: finalUrl,
      input: input.trim(),
      site: new URL(finalUrl).hostname.replace(/^www\./i, ''),
      description: page.description ?? null,
      image: page.image ?? null
    },
    samples: [
      {
        title,
        url: finalUrl,
        publishedAt: safeIso(page.publishedAt, now)
      }
    ]
  };
}

export const customConnector: Connector = {
  type: 'custom',
  defaultIntervalMinutes: 120,
  minIntervalMinutes: 30,

  resolve: resolveCustom,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<CustomState>> {
    const url = pageUrlFromConfig(ctx.config);
    if (!url) throw new ConnectorError('config', 'Link personalizado sem URL configurada.');

    const { finalUrl, page } = await renderCustomPage(url);
    const hash = contentHash(page);
    const now = new Date().toISOString();
    const previous = ctx.state as CustomState | null;
    const state: CustomState = {
      contentHash: hash,
      title: page.title,
      description: page.description,
      image: page.image,
      checkedAt: now
    };

    if (previous?.contentHash === hash) {
      return { items: [], state };
    }

    const title = page.title?.trim() || ctx.source.name;
    const item: RawItem = {
      externalId: hash,
      dedupeKey: `custom:${ctx.source.id}:${hash}`,
      kind: 'article',
      title: title.slice(0, 240),
      url: finalUrl,
      thumbnailUrl: page.image,
      description: page.description?.slice(0, 500) ?? null,
      author: page.author,
      publishedAt: safeIso(page.publishedAt, now),
      meta: { customPage: true, sourceUrl: url }
    };

    return { items: [item], state };
  }
};
