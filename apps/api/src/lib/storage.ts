/**
 * Armazenamento local: cache de streams, temporários do navegador e
 * manutenção do SQLite. Usado pela tela de Configurações.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env } from '../config/env';
import { db } from '../db/database';
import {
  clearTorrentCache,
  getTorrentCacheRoot,
  hasActiveTorrentSessions
} from './stremio/torrent/engine';
import { getSettings } from '../db/repositories/settings';
import {
  cleanupNovelChaptersOlderThan,
  cleanupNovelDetailsOlderThan,
  getNovelCacheStats,
  getNovelChapterCacheStats
} from '../db/repositories/novel-cache';
import { nowIso } from './dates';

const BROWSER_TEMP_PREFIX = 'hub-browser-';
const BROWSER_TEMP_MIN_AGE_MS = 30 * 60_000;
const DB_FILES = ['', '-wal', '-shm'];

export interface DirectoryStats {
  bytes: number;
  files: number;
  dirs: number;
}

async function directoryStats(root: string): Promise<DirectoryStats> {
  const stats: DirectoryStats = { bytes: 0, files: 0, dirs: 0 };

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stats.dirs += 1;
        await walk(path);
      } else if (entry.isFile()) {
        const stat = await fs.stat(path).catch(() => null);
        if (stat) {
          stats.bytes += stat.size;
          stats.files += 1;
        }
      }
    }
  };

  await walk(root);
  return stats;
}

async function databaseStats(): Promise<{ bytes: number; path: string }> {
  let bytes = 0;
  for (const suffix of DB_FILES) {
    const stat = await fs.stat(`${env.dbPath}${suffix}`).catch(() => null);
    if (stat) bytes += stat.size;
  }
  return { bytes, path: env.dbPath };
}

async function browserTempStats(): Promise<DirectoryStats> {
  const stats: DirectoryStats = { bytes: 0, files: 0, dirs: 0 };
  let entries;
  try {
    entries = await fs.readdir(tmpdir(), { withFileTypes: true });
  } catch {
    return stats;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(BROWSER_TEMP_PREFIX)) continue;
    const path = join(tmpdir(), entry.name);
    const current = await directoryStats(path);
    stats.bytes += current.bytes;
    stats.files += current.files;
    stats.dirs += 1;
  }
  return stats;
}

export async function getStorageStats() {
  const torrentCache = await directoryStats(getTorrentCacheRoot());
  const browserTemp = await browserTempStats();
  const database = await databaseStats();
  const novelCache = getNovelCacheStats();
  const novelOfflineCache = getNovelChapterCacheStats();
  return {
    torrentCache: { ...torrentCache, path: getTorrentCacheRoot() },
    browserTemp,
    database,
    novelCache,
    novelOfflineCache,
    totalCacheBytes: torrentCache.bytes + browserTemp.bytes + novelCache.bytes,
    updatedAt: nowIso()
  };
}

async function clearOldBrowserTemp(): Promise<DirectoryStats> {
  const stats: DirectoryStats = { bytes: 0, files: 0, dirs: 0 };
  let entries;
  try {
    entries = await fs.readdir(tmpdir(), { withFileTypes: true });
  } catch {
    return stats;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(BROWSER_TEMP_PREFIX)) continue;
    const path = join(tmpdir(), entry.name);
    const stat = await fs.stat(path).catch(() => null);
    if (!stat || now - stat.mtimeMs < BROWSER_TEMP_MIN_AGE_MS) continue;
    const current = await directoryStats(path);
    await fs.rm(path, { recursive: true, force: true }).catch(() => undefined);
    stats.bytes += current.bytes;
    stats.files += current.files;
    stats.dirs += 1;
  }
  return stats;
}

async function newestMtime(root: string): Promise<number | null> {
  let newest: number | null = null;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const stat = await fs.stat(path).catch(() => null);
        if (stat && (newest === null || stat.mtimeMs > newest)) newest = stat.mtimeMs;
      }
    }
  };
  await walk(root);
  return newest;
}

export interface TorrentCleanupResult {
  removed: boolean;
  freedBytes: number;
  freedFiles: number;
  reason: 'disabled' | 'empty' | 'recent' | 'active' | 'cleared';
}

/** Limpa todo o cache de torrents apenas quando ele está sem uso há N dias. */
export async function cleanupTorrentCacheIfOld(days: number): Promise<TorrentCleanupResult> {
  if (days <= 0) {
    return { removed: false, freedBytes: 0, freedFiles: 0, reason: 'disabled' };
  }

  const root = getTorrentCacheRoot();
  const before = await directoryStats(root);
  if (before.files === 0) {
    return { removed: false, freedBytes: 0, freedFiles: 0, reason: 'empty' };
  }
  if (hasActiveTorrentSessions()) {
    return { removed: false, freedBytes: 0, freedFiles: 0, reason: 'active' };
  }

  const newest = await newestMtime(root);
  if (newest === null || Date.now() - newest < days * 24 * 60 * 60_000) {
    return { removed: false, freedBytes: 0, freedFiles: 0, reason: 'recent' };
  }

  await clearTorrentCache();
  return {
    removed: true,
    freedBytes: before.bytes,
    freedFiles: before.files,
    reason: 'cleared'
  };
}

/** Manutenção automática: temporários antigos do navegador + cache de torrents. */
let lastNovelCleanupAt = 0;

const DATABASE_BACKUP_INTERVAL_MS = 24 * 60 * 60_000;
const DATABASE_BACKUP_RETENTION = 7;

export interface DatabaseBackupResult {
  created: boolean;
  path: string | null;
  removed: number;
}

/**
 * Cópia consistente do SQLite (VACUUM INTO) uma vez por dia, mantendo as 7
 * mais recentes. Fica em `data/backups/` e nunca entra no release.
 */
export async function runAutomaticDatabaseBackup(force = false): Promise<DatabaseBackupResult> {
  const root = join(dirname(env.dbPath), 'backups');
  await fs.mkdir(root, { recursive: true });

  const existing = (await fs.readdir(root).catch(() => [])).filter((name) =>
    /^hub-.*\.db$/i.test(name)
  );
  const withStats = await Promise.all(
    existing.map(async (name) => {
      const stat = await fs.stat(join(root, name)).catch(() => null);
      return { name, mtimeMs: stat?.mtimeMs ?? 0 };
    })
  );
  const latest = withStats.reduce((max, item) => Math.max(max, item.mtimeMs), 0);
  if (!force && latest > 0 && Date.now() - latest < DATABASE_BACKUP_INTERVAL_MS) {
    return { created: false, path: null, removed: 0 };
  }

  const stamp = nowIso().replace(/[:.]/g, '-').slice(0, 19);
  const target = join(root, `hub-${stamp}.db`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const after = (await fs.readdir(root).catch(() => []))
    .filter((name) => /^hub-.*\.db$/i.test(name))
    .sort();
  let removed = 0;
  while (after.length - removed > DATABASE_BACKUP_RETENTION) {
    await fs.rm(join(root, after[removed]), { force: true }).catch(() => undefined);
    removed += 1;
  }

  return { created: true, path: target, removed };
}

export async function runAutomaticMaintenance(): Promise<{
  enabled: boolean;
  browserTemp: DirectoryStats;
  torrent: TorrentCleanupResult;
  novelCache: { removed: number };
  databaseBackup: DatabaseBackupResult;
}> {
  const settings = getSettings();
  if (!settings.autoMaintenanceEnabled) {
    return {
      enabled: false,
      browserTemp: { bytes: 0, files: 0, dirs: 0 },
      torrent: { removed: false, freedBytes: 0, freedFiles: 0, reason: 'disabled' },
      novelCache: { removed: 0 },
      databaseBackup: { created: false, path: null, removed: 0 }
    };
  }

  const browserTemp = await clearOldBrowserTemp();
  const torrent = await cleanupTorrentCacheIfOld(settings.torrentCacheRetentionDays);

  const intervalMs = settings.novelCacheCleanupHours * 3_600_000;
  let detailsRemoved = 0;
  if (Date.now() - lastNovelCleanupAt >= intervalMs) {
    detailsRemoved = cleanupNovelDetailsOlderThan(settings.novelCacheRetentionHours);
    lastNovelCleanupAt = Date.now();
  }
  const chaptersRemoved = cleanupNovelChaptersOlderThan(settings.novelOfflineRetentionDays);
  const databaseBackup = await runAutomaticDatabaseBackup().catch((error) => {
    console.warn(
      `[storage] backup automático falhou: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { created: false, path: null, removed: 0 } satisfies DatabaseBackupResult;
  });

  return {
    enabled: true,
    browserTemp,
    torrent,
    novelCache: { removed: detailsRemoved + chaptersRemoved },
    databaseBackup
  };
}

export async function clearCaches() {
  const torrentRoot = getTorrentCacheRoot();
  const before = await directoryStats(torrentRoot);
  await clearTorrentCache();
  const after = await directoryStats(torrentRoot);
  const browserTemp = await clearOldBrowserTemp();

  const torrentFreed = Math.max(0, before.bytes - after.bytes);
  return {
    freedBytes: torrentFreed + browserTemp.bytes,
    freedFiles: Math.max(0, before.files - after.files) + browserTemp.files,
    torrentCache: {
      freedBytes: torrentFreed,
      freedFiles: Math.max(0, before.files - after.files)
    },
    browserTemp,
    updatedAt: nowIso()
  };
}

export async function optimizeDatabase() {
  const started = Date.now();
  const before = await databaseStats();
  db.exec('PRAGMA optimize;');
  db.exec('VACUUM;');
  const after = await databaseStats();
  return {
    beforeBytes: before.bytes,
    afterBytes: after.bytes,
    freedBytes: Math.max(0, before.bytes - after.bytes),
    elapsedMs: Date.now() - started
  };
}
