/**
 * Configuração central da API.
 * Segredos vivem apenas no .env — nunca no código.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

/** Raiz do repositório: apps/api/src/config -> ../../../.. */
export const repoRoot = resolve(here, '../../../..');

// Carrega .env e .env.local da raiz (o .env.local tem prioridade).
for (const file of ['.env', '.env.local']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) dotenv.config({ path });
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

/** Pasta de dados: `data/` no projeto ou uma pasta gravável no app empacotado. */
const dataDir = process.env.HUB_DATA_DIR?.trim()
  ? resolve(process.env.HUB_DATA_DIR.trim())
  : resolve(repoRoot, 'data');

const configuredDb = process.env.HUB_DB_PATH?.trim();
const dbPath = configuredDb
  ? isAbsolute(configuredDb)
    ? configuredDb
    : resolve(repoRoot, configuredDb)
  : resolve(dataDir, 'hub.db');

// O app empacotado não tem .env. Gera uma chave local persistente para
// criptografar as URLs dos addons do Stremio.
const appSecretFile = resolve(dirname(dbPath), 'app-secret');
if (!process.env.APP_SECRET?.trim()) {
  try {
    if (!existsSync(appSecretFile)) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(appSecretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    process.env.APP_SECRET = readFileSync(appSecretFile, 'utf8').trim();
  } catch (error) {
    console.error('[env] não foi possível gerar o APP_SECRET local:', error);
  }
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  dbPath,
  timezone: process.env.TZ ?? 'America/Sao_Paulo',
  seedDemo: bool(process.env.HUB_SEED_DEMO, true),
  version: '0.4.9',
  phase: 3
};

export const paths = {
  repoRoot,
  webDist: process.env.HUB_WEB_DIST?.trim()
    ? resolve(process.env.HUB_WEB_DIST.trim())
    : resolve(repoRoot, 'apps/web/dist'),
  migrations: process.env.HUB_MIGRATIONS?.trim()
    ? resolve(process.env.HUB_MIGRATIONS.trim())
    : resolve(here, '../db/migrations')
};
