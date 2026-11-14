#!/usr/bin/env node
/**
 * Limpa artefatos de build antigos.
 *
 * Uso:
 *   node scripts/clean-builds.mjs --dry-run
 *   node scripts/clean-builds.mjs --yes
 *   node scripts/clean-builds.mjs --yes --temp --dev
 *
 * Por padrão só mexe em `release/` e `dist/android/`. `--temp` remove as
 * pastas mb-* de teste e `--dev` remove os caches do app de desenvolvimento.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = String(pkg.version);

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--yes');
const includeTemp = args.has('--temp');
const includeDev = args.has('--dev');
const keepUnpacked = args.has('--keep-unpacked');

const removed = [];
const kept = [];

function sizeOf(path) {
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of readdirSync(path)) {
      total += sizeOf(join(path, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

function remove(path, label) {
  if (!existsSync(path)) return;
  const bytes = sizeOf(path);
  if (dryRun) {
    removed.push({ path: label, bytes });
    return;
  }
  try {
    rmSync(path, { recursive: true, force: true });
    removed.push({ path: label, bytes });
  } catch (error) {
    console.error(`não foi possível remover ${label}: ${error.message}`);
  }
}

function keep(path, label) {
  if (existsSync(path)) kept.push({ path: label, bytes: sizeOf(path) });
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// release/: mantém apenas a versão atual (e os arquivos de update).
// ---------------------------------------------------------------------------
const releaseDir = join(root, 'release');
const currentReleaseFiles = new Set([
  `Minha-Bolha-Setup-${version}.exe`,
  `Minha-Bolha-Setup-${version}.exe.blockmap`,
  `Minha-Bolha-Portable-${version}.zip`,
  `Minha-Bolha-${version}-x86_64.AppImage`,
  'latest.yml',
  'latest-linux.yml'
]);

if (existsSync(releaseDir)) {
  for (const entry of readdirSync(releaseDir)) {
    const full = join(releaseDir, entry);
    if (entry === 'win-unpacked') {
      if (keepUnpacked) keep(full, `release/${entry}`);
      else remove(full, `release/${entry}`);
      continue;
    }
    if (currentReleaseFiles.has(entry)) {
      keep(full, `release/${entry}`);
      continue;
    }
    // Só remove artefatos do próprio app; arquivos desconhecidos ficam.
    if (entry.startsWith('Minha-Bolha-') || entry.endsWith('.AppImage')) {
      remove(full, `release/${entry}`);
    }
  }
}

// ---------------------------------------------------------------------------
// dist/android/: mantém o maior alphaNN de cada versão.
// ---------------------------------------------------------------------------
const androidDir = join(root, 'dist', 'android');
if (existsSync(androidDir)) {
  const files = readdirSync(androidDir);
  const alphas = files
    .map((name) => ({ name, match: /^Minha-Bolha-.*?-alpha(\d+)/i.exec(name) }))
    .filter((entry) => entry.match)
    .map((entry) => ({ name: entry.name, alpha: Number(entry.match[1]) }));
  const newestAlpha = alphas.length > 0 ? Math.max(...alphas.map((entry) => entry.alpha)) : null;

  for (const file of files) {
    const full = join(androidDir, file);
    const match = /^Minha-Bolha-.*?-alpha(\d+)/i.exec(file);
    if (match && newestAlpha !== null && Number(match[1]) < newestAlpha) {
      remove(full, `dist/android/${file}`);
    } else if (match) {
      keep(full, `dist/android/${file}`);
    }
  }
}

// ---------------------------------------------------------------------------
// %TEMP%/mb-*: cópias de teste (opcional).
// ---------------------------------------------------------------------------
if (includeTemp) {
  const tempDir = os.tmpdir();
  const allowed = /^mb-(alpha|linux-|user-|test-data|android-|apk-check|bluestacks|update-dest|release|desktop-|final|media3-apk|session-apk|torrent-apk|fgs-apk|smoke)/i;
  for (const entry of readdirSync(tempDir)) {
    if (!allowed.test(entry)) continue;
    remove(join(tempDir, entry), `%TEMP%/${entry}`);
  }
}

// ---------------------------------------------------------------------------
// Caches do app de desenvolvimento (opcional).
// ---------------------------------------------------------------------------
if (includeDev) {
  for (const relative of ['data/browser-profile', 'data/desktop']) {
    remove(join(root, relative), relative);
  }
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
const totalRemoved = removed.reduce((sum, entry) => sum + entry.bytes, 0);
const totalKept = kept.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(dryRun ? 'Modo dry-run (nada foi apagado).' : 'Limpeza concluída.');
if (kept.length > 0) {
  console.log('\nMantidos:');
  for (const entry of kept) console.log(`  ${entry.path} (${formatBytes(entry.bytes)})`);
}
if (removed.length > 0) {
  console.log(dryRun ? '\nSeriam removidos:' : '\nRemovidos:');
  for (const entry of removed) console.log(`  ${entry.path} (${formatBytes(entry.bytes)})`);
}
console.log(
  `\n${dryRun ? 'A liberar' : 'Liberado'}: ${formatBytes(totalRemoved)} · Mantido: ${formatBytes(totalKept)}`
);
if (dryRun) console.log('Execute com --yes para apagar.');
