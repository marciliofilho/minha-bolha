/**
 * Guarda simples contra SSRF para URLs fornecidas pelo usuário.
 * Uso pessoal e local, mas não custa evitar que "http://192.168.0.1" vire
 * uma requisição do backend.
 */
import { lookup } from 'node:dns/promises';
import { ConnectorError } from '../connectors/types';

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // fc00::/7
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
    return true; // fe80::/10
  }
  // IPv4 mapeado em IPv6 (::ffff:192.168.0.1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (isPrivateIpv4(host)) return true;
  if (host.includes(':') && isPrivateIpv6(host)) return true;
  return false;
}

/** Valida protocolo e destino; devolve a URL normalizada. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError('config', 'URL inválida. Inclua http:// ou https://.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('config', 'Apenas URLs http ou https são aceitas.');
  }

  if (isPrivateHost(url.hostname.toLowerCase())) {
    throw new ConnectorError('config', 'Endereços da rede local não são permitidos.');
  }

  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.some((entry) => isPrivateHost(entry.address))) {
      throw new ConnectorError('config', 'O endereço aponta para a rede local.');
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    // Falha de DNS: deixamos o fetch reportar o erro de rede real.
  }

  return url;
}
