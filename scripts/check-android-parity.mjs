#!/usr/bin/env node
/**
 * Garante que o Android não divergiu do desktop.
 *
 * Hoje compara as categorias do sistema (`SYSTEM_CATEGORIES` em @hub/shared)
 * com a cópia em Kotlin usada para semear o SQLite no primeiro boot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sharedPath = resolve(root, 'packages/shared/src/index.ts');
const kotlinPath = resolve(
  root,
  'apps/android/app/src/main/java/com/minhabolha/android/SystemCategories.kt'
);

const sharedSource = readFileSync(sharedPath, 'utf8');
const kotlinSource = readFileSync(kotlinPath, 'utf8');

const sharedStart = sharedSource.indexOf('export const SYSTEM_CATEGORIES');
if (sharedStart === -1) {
  console.error('SYSTEM_CATEGORIES não encontrado em packages/shared/src/index.ts');
  process.exit(1);
}
const sharedBlock = sharedSource.slice(sharedStart, sharedSource.indexOf('];', sharedStart));

const sharedEntries = [...sharedBlock.matchAll(
  /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*icon:\s*'([^']+)',\s*color:\s*'([^']+)',\s*sortOrder:\s*(\d+)/g
)].map((match) => ({
  id: match[1],
  label: match[2],
  icon: match[3],
  color: match[4].toLowerCase(),
  sortOrder: Number(match[5])
}));

const kotlinEntries = [...kotlinSource.matchAll(
  /SystemCategory\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*(\d+)\)/g
)].map((match) => ({
  id: match[1],
  label: match[2],
  icon: match[3],
  color: match[4].toLowerCase(),
  sortOrder: Number(match[5])
}));

if (sharedEntries.length === 0) {
  console.error('Nenhuma categoria encontrada em @hub/shared.');
  process.exit(1);
}
if (kotlinEntries.length === 0) {
  console.error('Nenhuma categoria encontrada em SystemCategories.kt.');
  process.exit(1);
}

const problems = [];
if (sharedEntries.length !== kotlinEntries.length) {
  problems.push(
    `quantidade diferente: shared=${sharedEntries.length}, kotlin=${kotlinEntries.length}`
  );
}

const max = Math.max(sharedEntries.length, kotlinEntries.length);
for (let index = 0; index < max; index += 1) {
  const shared = sharedEntries[index];
  const kotlin = kotlinEntries[index];
  if (!shared || !kotlin) continue;
  for (const field of ['id', 'label', 'icon', 'color', 'sortOrder']) {
    if (String(shared[field]) !== String(kotlin[field])) {
      problems.push(
        `categoria ${index}: ${field} difere (shared="${shared[field]}", kotlin="${kotlin[field]}")`
      );
    }
  }
}

if (problems.length > 0) {
  console.error('Categorias do Android divergem do desktop:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Paridade Android OK: ${sharedEntries.length} categorias do sistema idênticas.`);
