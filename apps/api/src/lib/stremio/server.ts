/** Stremio Streaming Server local (torrentes, HLS e proxy). */
export function getStremioServerUrl(): string {
  const configured = process.env.STREMIO_SERVER_URL?.trim();
  return (configured || 'http://127.0.0.1:11470').replace(/\/+$/, '');
}

export async function getStremioServerStatus(): Promise<{
  available: boolean;
  baseUrl: string;
  version: string | null;
}> {
  const baseUrl = getStremioServerUrl();
  try {
    const response = await fetch(`${baseUrl}/settings`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return { available: false, baseUrl, version: null };
    const data = (await response.json().catch(() => null)) as
      | { values?: { serverVersion?: unknown } }
      | null;
    const version =
      typeof data?.values?.serverVersion === 'string' ? data.values.serverVersion : null;
    return { available: true, baseUrl, version };
  } catch {
    return { available: false, baseUrl, version: null };
  }
}
