/** Canal SSE (Server-Sent Events) para avisar o frontend em tempo real. */
import type { Response } from 'express';
import { createLogger } from './lib/logger';

const log = createLogger('sse');
const clients = new Set<Response>();
let heartbeat: NodeJS.Timeout | null = null;

function ensureHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(': ping\n\n');
      } catch {
        clients.delete(client);
      }
    }
  }, 25_000);
  heartbeat.unref();
}

export function addSseClient(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`);
  clients.add(res);
  ensureHeartbeat();

  const cleanup = (): void => {
    clients.delete(res);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function broadcast(type: string, payload: Record<string, unknown> = {}): void {
  if (clients.size === 0) return;
  const frame = `data: ${JSON.stringify({ type, ...payload, at: new Date().toISOString() })}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch (error) {
      log.debug('cliente SSE desconectado', error);
      clients.delete(client);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}
