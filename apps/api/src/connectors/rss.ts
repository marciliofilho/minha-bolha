/**
 * Conector RSS/Atom genérico (notícias, blogs, podcasts).
 * Suporta RSS 2.0, Atom e RSS 1.0 (RDF).
 */
import { XMLParser } from 'fast-xml-parser';
import type { ResolvedSourceDto, SettingsDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawItem } from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { absoluteUrl, firstImageFromHtml, safeIso, shortHash, stripHtml, truncate, xmlText } from './util';
import { assertPublicUrl } from '../lib/ssrf';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

interface ParsedEntry {
  title: string;
  link: string | null;
  guid: string;
  publishedAt: string | null;
  summary: string;
  author: string | null;
  image: string | null;
}

interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  entries: ParsedEntry[];
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickAttr(value: unknown, attr: string): string | null {
  for (const item of asArray(value)) {
    const record = asRecord(item);
    if (record && typeof record[attr] === 'string') return record[attr];
  }
  return null;
}

function pickAtomLink(value: unknown): string | null {
  const links = asArray(value);
  const records = links.map(asRecord).filter(Boolean) as Array<Record<string, unknown>>;
  const alternate = records.find(
    (link) => (!link['@_rel'] || link['@_rel'] === 'alternate') && typeof link['@_href'] === 'string'
  );
  if (alternate && typeof alternate['@_href'] === 'string') return alternate['@_href'];
  const href = records.find((link) => typeof link['@_href'] === 'string');
  return href && typeof href['@_href'] === 'string' ? href['@_href'] : null;
}

function pickImage(item: Record<string, unknown>, summary: string, baseUrl: string | null): string | null {
  const candidates = [
    pickAttr(item['media:thumbnail'], '@_url'),
    pickAttr(item['media:content'], '@_url'),
    pickAttr(item.enclosure, '@_url'),
    pickAttr(item['itunes:image'], '@_href'),
    pickAttr(item.image, '@_url')
  ];
  for (const candidate of candidates) {
    if (candidate) {
      const resolved = absoluteUrl(candidate, baseUrl ?? undefined);
      if (resolved) return resolved;
    }
  }
  return firstImageFromHtml(summary, baseUrl ?? undefined);
}

function parseFeedDocument(xml: string, fallbackBase: string | null = null): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ConnectorError('layout_changed', 'O feed não pôde ser lido como XML.');
  }

  const rss = asRecord(doc.rss);
  const rdf = asRecord(doc['rdf:RDF']) ?? asRecord(doc.RDF);
  const atom = asRecord(doc.feed);

  const channel = rss ? asRecord(rss.channel) : rdf ? asRecord(rdf.channel) : null;
  const rawEntries = channel ? channel.item : atom ? atom.entry : rdf ? rdf.item : undefined;
  const entries = asArray(rawEntries);

  const title = channel ? xmlText(channel.title) || xmlText(asRecord(channel.title)?.['#text']) : atom ? xmlText(atom.title) : '';
  const siteLink = channel
    ? typeof channel.link === 'string'
      ? channel.link
      : xmlText(channel.link)
    : atom
      ? pickAtomLink(atom.link) ?? ''
      : '';

  const siteUrl = siteLink ? absoluteUrl(siteLink, fallbackBase ?? undefined) : fallbackBase;

  const parsedEntries: ParsedEntry[] = [];
  for (const raw of entries) {
    const item = asRecord(raw);
    if (!item) continue;

    const titleText = stripHtml(xmlText(item.title)) || 'Sem título';
    const link =
      (typeof item.link === 'string' ? item.link : xmlText(item.link) || pickAtomLink(item.link)) ||
      (typeof item.guid === 'string' ? item.guid : xmlText(item.guid)) ||
      (typeof item['@_rdf:about'] === 'string' ? item['@_rdf:about'] : null) ||
      (typeof item.id === 'string' ? item.id : xmlText(item.id)) ||
      null;

    const resolvedLink = link ? absoluteUrl(link, siteUrl ?? undefined) : null;
    if (!resolvedLink) continue;

    const guid =
      (typeof item.guid === 'string' ? item.guid : xmlText(item.guid)) ||
      (typeof item.id === 'string' ? item.id : xmlText(item.id)) ||
      resolvedLink;

    const summaryHtml =
      xmlText(item.description) ||
      xmlText(item.summary) ||
      xmlText(item['content:encoded']) ||
      xmlText(item.content) ||
      '';

    const author =
      stripHtml(xmlText(item.author)) ||
      stripHtml(xmlText(item['dc:creator'])) ||
      stripHtml(xmlText(item['itunes:author'])) ||
      null;

    const dateText = xmlText(item.pubDate) || xmlText(item.published) || xmlText(item.updated) || xmlText(item['dc:date']);

    parsedEntries.push({
      title: truncate(titleText, 240),
      link: resolvedLink,
      guid,
      publishedAt: safeIso(dateText, '') || null,
      summary: summaryHtml,
      author,
      image: pickImage(item, summaryHtml, siteUrl)
    });
  }

  return { title: stripHtml(title), siteUrl, entries: parsedEntries };
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 600).toLowerCase();
  if (head.includes('<rss') || head.includes('<feed') || head.includes('<rdf')) return false;
  return head.includes('<!doctype html') || head.includes('<html');
}

async function resolveFeed(input: string, _settings: SettingsDto): Promise<ResolvedSourceDto> {
  const withProtocol = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = await assertPublicUrl(withProtocol);

  const response = await fetchText(url.toString(), {
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'
  });

  if (looksLikeHtml(response.text)) {
    throw new ConnectorError(
      'config',
      'Essa URL devolve uma página HTML, não um feed. Procure o link "RSS" do site ou use um link personalizado (Fase 5).'
    );
  }

  const parsed = parseFeedDocument(response.text, response.finalUrl);
  if (!parsed.title && parsed.entries.length === 0) {
    throw new ConnectorError('not_found', 'Nenhum item encontrado. Confirme se a URL é de um feed RSS/Atom.');
  }

  return {
    name: parsed.title || url.hostname,
    categoryId: 'news',
    config: { url: response.finalUrl, siteUrl: parsed.siteUrl, input },
    samples: parsed.entries.slice(0, 3).map((entry) => ({
      title: entry.title,
      url: entry.link ?? withProtocol,
      publishedAt: entry.publishedAt
    }))
  };
}

export const rssConnector: Connector = {
  type: 'rss',
  defaultIntervalMinutes: 30,
  minIntervalMinutes: 15,

  resolve: resolveFeed,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastFetchedAt: string; lastPublishedAt: string | null }>> {
    const url = typeof ctx.config.url === 'string' ? ctx.config.url : '';
    if (!url) throw new ConnectorError('config', 'Feed RSS sem URL configurada.');

    const response = await fetchText(url, {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'
    });

    if (looksLikeHtml(response.text)) {
      throw new ConnectorError('layout_changed', 'O endereço passou a devolver HTML em vez de feed.');
    }

    const parsed = parseFeedDocument(response.text, response.finalUrl);
    const now = new Date().toISOString();

    const items: RawItem[] = parsed.entries.slice(0, 200).map((entry) => {
      const publishedAt = entry.publishedAt ?? now;
      return {
        externalId: entry.guid,
        dedupeKey: `rss:${ctx.source.id}:${shortHash(entry.guid || entry.link || entry.title)}`,
        kind: 'article',
        title: entry.title,
        url: entry.link ?? url,
        thumbnailUrl: entry.image,
        description: truncate(stripHtml(entry.summary), 320) || null,
        author: entry.author,
        publishedAt,
        meta: { feedTitle: parsed.title }
      };
    });

    const lastPublishedAt = items.reduce<string | null>((latest, item) => {
      if (!latest) return item.publishedAt;
      return item.publishedAt > latest ? item.publishedAt : latest;
    }, null);

    ctx.logger.debug(`RSS ${parsed.title || url}: ${items.length} item(s)`);
    return { items, state: { lastFetchedAt: now, lastPublishedAt } };
  }
};
