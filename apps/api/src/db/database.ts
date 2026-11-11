/**
 * Conexão SQLite usando o módulo nativo `node:sqlite` (Node >= 22.5).
 * Vantagem: zero dependências nativas para compilar no Windows.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env, paths } from '../config/env';
import { createLogger } from '../lib/logger';
import { nowIso } from '../lib/dates';
import { SYSTEM_CATEGORIES } from '@hub/shared';

const log = createLogger('db');

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);

// WAL melhora leitura concorrente; foreign_keys garante integridade.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

/** Aplica migrations pendentes em transação, em ordem alfabética. */
function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((row) => row.name)
  );

  const files = readdirSync(paths.migrations)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(paths.migrations, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, nowIso());
      db.exec('COMMIT');
      log.info(`migration aplicada: ${file}`);
    } catch (error) {
      db.exec('ROLLBACK');
      log.error(`falha na migration ${file}`, error);
      throw error;
    }
  }
}

/** Garante que as categorias do sistema existam (idempotente). */
export function ensureSystemCategories(): void {
  const insert = db.prepare(`
    INSERT INTO categories (id, label, icon, color, sort_order, is_system)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      icon = excluded.icon,
      color = excluded.color,
      sort_order = excluded.sort_order
  `);
  for (const category of SYSTEM_CATEGORIES) {
    insert.run(category.id, category.label, category.icon, category.color, category.sortOrder);
  }
}

migrate();
ensureSystemCategories();

log.info(`SQLite pronto em ${env.dbPath}`);
