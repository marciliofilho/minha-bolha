/** Montagem do app Express (rotas, estáticos em produção e erros). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { paths } from '../config/env';
import { createLogger } from '../lib/logger';
import { errorHandler } from './errors';
import { feedRouter } from './routes/feed';
import { itemsRouter } from './routes/items';
import { settingsRouter } from './routes/settings';
import { sourcesRouter } from './routes/sources';
import { systemRouter } from './routes/system';
import { mediaRouter } from './routes/media';
import { calendarRouter } from './routes/calendar';
import { gamesRouter } from './routes/games';
import { secretsRouter } from './routes/secrets';
import { stremioRouter } from './routes/stremio';
import { stremioAddonsRouter } from './routes/stremio-addons';
import { stremioTorrentRouter } from './routes/stremio-torrent';
import { playbackRouter } from './routes/playback';
import { browserRouter } from './routes/browser';
import { translateRouter } from './routes/translate';
import { backupRouter } from './routes/backup';

const log = createLogger('http');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // O backup pode incluir feed, novels e biblioteca; aceita JSON maior apenas
  // nas rotas de prévia/importação antes do parser global de 1 MB.
  app.use(
    ['/api/backup/preview', '/api/backup/import'],
    express.json({ limit: '128mb' })
  );
  app.use(express.json({ limit: '1mb' }));

  // Log curto de requisições (o SSE fica de fora para não poluir).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/events') return;
      log.debug(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started}ms)`);
    });
    next();
  });

  app.use('/api', feedRouter);
  app.use('/api', itemsRouter);
  app.use('/api', sourcesRouter);
  app.use('/api', settingsRouter);
  app.use('/api', mediaRouter);
  app.use('/api', calendarRouter);
  app.use('/api', gamesRouter);
  app.use('/api', secretsRouter);
  app.use('/api', stremioRouter);
  app.use('/api', stremioAddonsRouter);
  app.use('/api', stremioTorrentRouter);
  app.use('/api', playbackRouter);
  app.use('/api', browserRouter);
  app.use('/api', translateRouter);
  app.use('/api', backupRouter);
  app.use('/api', systemRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota de API não encontrada.', code: 'not_found' });
  });

  // Em produção (`npm run build`), a API também serve o frontend compilado.
  const indexHtml = join(paths.webDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(
      express.static(paths.webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          // O HTML aponta para o bundle com hash; não pode ficar preso em cache.
          if (filePath.endsWith('.html')) {
            res.setHeader('cache-control', 'no-cache');
            return;
          }
          // Assets do Vite têm hash no nome: cache imutável de 1 ano.
          if (filePath.replace(/\\/g, '/').includes('/assets/')) {
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          }
        }
      })
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.setHeader('cache-control', 'no-cache');
      res.sendFile(indexHtml);
    });
    log.info(`servindo frontend de ${paths.webDist}`);
  }

  app.use(errorHandler);
  return app;
}
