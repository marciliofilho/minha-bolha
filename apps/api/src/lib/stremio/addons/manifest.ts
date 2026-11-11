/**
 * Manifest e capacidades de addons do Stremio (protocolo HTTP).
 * A URL do manifest pode conter configuração/chaves e nunca é exposta.
 */
import type { AddonCatalogDto, AddonResourceDto } from '@hub/shared';
import { ConnectorError } from '../../../connectors/types';

export const ADDON_TIMEOUT_MS = 10_000;
export const ADDON_MAX_BYTES = 1024 * 1024;

export interface AddonManifestCatalog {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
  extraSupported?: string[];
  extraRequired?: string[];
}

export interface AddonManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  resources: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>;
  types: string[];
  idPrefixes?: string[];
  catalogs?: AddonManifestCatalog[];
  logo?: string;
  background?: string;
  behaviorHints?: Record<string, unknown>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Converte stremio:// e URLs sem protocolo em https://.../manifest.json. */
export function normalizeAddonUrl(raw: string): string {
  let value = raw.trim();
  if (!value) throw new ConnectorError('config', 'Informe a URL do manifest.json do addon.');
  if (value.length > 2048) throw new ConnectorError('config', 'URL do addon grande demais.');

  if (value.startsWith('stremio://')) {
    value = `https://${value.slice('stremio://'.length)}`;
  } else if (value.startsWith('web+stremio://')) {
    value = `https://${value.slice('web+stremio://'.length)}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError('config', 'URL do addon inválida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('config', 'O addon precisa usar http ou https.');
  }
  if (!url.hostname) throw new ConnectorError('config', 'A URL do addon não tem host.');

  assertAllowedAddonHost(url);
  url.hash = '';

  if (!url.pathname.endsWith('/manifest.json')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  }

  return url.toString();
}

export function manifestBaseUrl(transportUrl: string): string {
  const url = new URL(transportUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  url.hash = '';
  return url.toString();
}

/** Bloqueia apenas destinos de metadados; localhost/LAN são permitidos. */
export function assertAllowedAddonHost(url: URL): void {
  const host = url.hostname.toLowerCase();
  if (
    host === '0.0.0.0' ||
    host === '::' ||
    host === '[::]' ||
    host === '169.254.169.254' ||
    host.endsWith('.metadata.google.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new ConnectorError('config', 'Este endereço não é permitido para addons.');
  }
}

/** Mascara a URL para a interface: host + manifest, sem caminho/config. */
export function maskAddonUrl(transportUrl: string): string {
  try {
    const url = new URL(transportUrl);
    return `${url.origin}/••••/manifest.json${url.search ? '?••••' : ''}`;
  } catch {
    return '••••';
  }
}

export function addonOrigin(transportUrl: string): string {
  try {
    return new URL(transportUrl).origin;
  } catch {
    return 'addon';
  }
}

export function parseAddonManifest(value: unknown): AddonManifest {
  if (!isRecord(value)) {
    throw new ConnectorError('layout_changed', 'O addon não devolveu um manifest JSON válido.');
  }

  const id = textOrNull(value.id);
  if (!id) throw new ConnectorError('layout_changed', 'Manifest sem "id".');

  const resources = Array.isArray(value.resources) ? value.resources : [];
  const normalizedResources: AddonManifest['resources'] = [];
  for (const resource of resources) {
    if (typeof resource === 'string' && resource.trim()) {
      normalizedResources.push(resource.trim());
      continue;
    }
    if (isRecord(resource) && typeof resource.name === 'string' && resource.name.trim()) {
      normalizedResources.push({
        name: resource.name.trim(),
        ...(isStringArray(resource.types) ? { types: resource.types } : {}),
        ...(isStringArray(resource.idPrefixes) ? { idPrefixes: resource.idPrefixes } : {})
      });
    }
  }
  if (normalizedResources.length === 0) {
    throw new ConnectorError('layout_changed', 'O manifest do addon não declara recursos.');
  }

  let types = isStringArray(value.types) ? value.types : [];
  if (types.length === 0) {
    const derived = new Set<string>();
    for (const resource of normalizedResources) {
      if (typeof resource === 'object') {
        for (const type of resource.types ?? []) derived.add(type);
      }
    }
    types = [...derived];
  }
  if (types.length === 0) {
    throw new ConnectorError('layout_changed', 'O manifest do addon não declara tipos.');
  }

  const catalogs: AddonManifestCatalog[] = [];
  if (Array.isArray(value.catalogs)) {
    for (const catalog of value.catalogs) {
      if (!isRecord(catalog)) continue;
      const type = textOrNull(catalog.type);
      const catalogId = textOrNull(catalog.id);
      if (!type || !catalogId) continue;
      const extraSupported = isStringArray(catalog.extraSupported)
        ? catalog.extraSupported
        : Array.isArray(catalog.extra)
          ? catalog.extra
              .map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name : null))
              .filter((entry): entry is string => Boolean(entry))
          : [];
      const extraRequired = isStringArray(catalog.extraRequired)
        ? catalog.extraRequired
        : Array.isArray(catalog.extra)
          ? catalog.extra
              .filter((entry) => isRecord(entry) && entry.isRequired === true)
              .map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name : null))
              .filter((entry): entry is string => Boolean(entry))
          : [];
      catalogs.push({
        type,
        id: catalogId,
        name: textOrNull(catalog.name) ?? catalogId,
        ...(Array.isArray(catalog.extra) ? { extra: catalog.extra as AddonManifestCatalog['extra'] } : {}),
        extraSupported,
        extraRequired
      });
    }
  }

  return {
    id,
    name: textOrNull(value.name) ?? id,
    description: textOrNull(value.description) ?? undefined,
    version: textOrNull(value.version) ?? '0.0.0',
    resources: normalizedResources,
    types,
    ...(isStringArray(value.idPrefixes) ? { idPrefixes: value.idPrefixes } : {}),
    catalogs,
    logo: textOrNull(value.logo) ?? undefined,
    background: textOrNull(value.background) ?? undefined,
    behaviorHints: isRecord(value.behaviorHints) ? value.behaviorHints : undefined
  };
}

export function resourceCapability(
  manifest: AddonManifest,
  name: string
): { types: string[]; idPrefixes: string[] } | null {
  for (const resource of manifest.resources) {
    if (typeof resource === 'string') {
      if (resource === name) {
        return { types: manifest.types, idPrefixes: manifest.idPrefixes ?? [] };
      }
      continue;
    }
    if (resource.name === name) {
      return {
        types: resource.types ?? manifest.types,
        idPrefixes: resource.idPrefixes ?? manifest.idPrefixes ?? []
      };
    }
  }
  return null;
}

export function supportsResource(
  manifest: AddonManifest,
  name: string,
  type: string,
  id: string
): boolean {
  const capability = resourceCapability(manifest, name);
  if (!capability) return false;
  if (!capability.types.includes(type)) return false;
  if (capability.idPrefixes.length === 0) return true;
  return capability.idPrefixes.some((prefix) => id.startsWith(prefix));
}

export function manifestResources(manifest: AddonManifest): AddonResourceDto[] {
  const seen = new Set<string>();
  const result: AddonResourceDto[] = [];
  for (const resource of manifest.resources) {
    const name = typeof resource === 'string' ? resource : resource.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const capability = resourceCapability(manifest, name);
    result.push({
      name,
      types: capability?.types ?? manifest.types,
      idPrefixes: capability?.idPrefixes ?? manifest.idPrefixes ?? []
    });
  }
  return result;
}

export function manifestCatalogs(manifest: AddonManifest): AddonCatalogDto[] {
  return (manifest.catalogs ?? []).map((catalog) => {
    const extraSupported = catalog.extraSupported ?? [];
    return {
      type: catalog.type,
      id: catalog.id,
      name: catalog.name ?? catalog.id,
      extraSupported,
      extraRequired: catalog.extraRequired ?? [],
      canSearch: extraSupported.includes('search')
    };
  });
}
