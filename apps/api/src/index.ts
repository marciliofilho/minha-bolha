/** Ponto de entrada da API. */
import { env } from './config/env';
import { db } from './db/database';
import { countGames } from './db/repositories/games';
import { applyInitialLanguage } from './db/repositories/settings';
import { createApp } from './http/server';
import { createLogger } from './lib/logger';
import { seedDemoData, ensureDemoGames } from './seed';
import { startScheduler, stopScheduler } from './scheduler';
import { ensureGgdealsSource } from './domain/games';
import { ensureBuiltinKitsuAddon } from './domain/stremio-addons';
import { ensureGlobalReleasesSource } from './domain/global-releases';
import { countGlobalReleases } from './db/repositories/global-releases';
import { listSecretStatuses } from './lib/secrets';
import { enqueueSource } from './scheduler';

const log = createLogger('server');
const host = process.env.HOST ?? '127.0.0.1';

// Primeiro boot do app desktop: o idioma escolhido antes da intro.
applyInitialLanguage();

// Catálogos de anime prontos para uso, mas visíveis como addon instalado.
ensureBuiltinKitsuAddon();

// O motor de torrent e conectores de terceiros podem emitir erros assíncronos
// sem um consumidor direto. Logar mantém o Hub no ar em vez de encerrar tudo.
process.on('unhandledRejection', (reason) => {
  log.error(`promise não tratada: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});
process.on('uncaughtException', (error) => {
  log.error(`exceção não tratada: ${error.stack ?? error.message}`);
});

if (env.seedDemo) {
  const seeded = seedDemoData();
  if (!seeded.skipped) {
    log.info(
      `dados de demonstração criados: ${seeded.sources} fontes, ${seeded.items} itens e ${seeded.games} jogos`
    );
  } else {
    const games = ensureDemoGames();
    if (games > 0) log.info(`dados demo de jogos adicionados: ${games}`);
  }
}

// Se já houver jogos e uma chave do gg.deals (no app ou no .env), garante a
// fonte de preços — ela pode ter sido criada em uma execução anterior.
if (countGames() > 0) {
  ensureGgdealsSource();
}

const app = createApp();

const server = app.listen(env.port, host, () => {
  log.info(`Hub rodando em http://${host}:${env.port} (fase ${env.phase})`);
  const secrets = listSecretStatuses();
  const label = (id: string): string => {
    const status = secrets.find((item) => item.id === id);
    return status?.configured ? 'sim' : 'não';
  };
  log.info(
    `chaves configuradas → TMDB: ${label('tmdb')} | Steam: ${label('steam')} | gg.deals: ${label('ggdeals')}`
  );
});

startScheduler();

// O calendário global deve popular a tela no primeiro boot. Em reinícios
// próximos, deixamos o scheduler cuidar para não estourar o rate limit.
const globalReleasesSource = ensureGlobalReleasesSource();
const lastGlobalSync = globalReleasesSource.lastSuccessAt
  ? Date.parse(globalReleasesSource.lastSuccessAt)
  : 0;
if (countGlobalReleases() === 0 || Date.now() - lastGlobalSync > 2 * 60 * 60_000) {
  enqueueSource(globalReleasesSource.id, true);
}

function shutdown(signal: string): void {
  log.info(`recebido ${signal}, encerrando…`);
  stopScheduler();
  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });
  // Garante saída mesmo se alguma conexão SSE ficar aberta.
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
