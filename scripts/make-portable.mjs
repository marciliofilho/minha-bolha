/**
 * Gera a pasta portátil a partir do build do electron-builder.
 *
 * - Copia `release/win-unpacked` para `release/portable/Minha Bolha`.
 * - Adiciona `portable.txt`, que faz o app guardar os dados ao lado do .exe.
 * - Compacta em `release/Minha-Bolha-Portable-<versão>.zip`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const release = path.join(root, 'release');
const unpacked = path.join(release, 'win-unpacked');
const portableRoot = path.join(release, 'portable');
const folder = path.join(portableRoot, 'Minha Bolha');

if (!fs.existsSync(unpacked)) {
  throw new Error('release/win-unpacked não existe. Rode o empacotamento antes.');
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zipPath = path.join(release, `Minha-Bolha-Portable-${pkg.version}.zip`);

await rm(portableRoot, { recursive: true, force: true });
await mkdir(portableRoot, { recursive: true });
await cp(unpacked, folder, { recursive: true });
await writeFile(path.join(folder, 'portable.txt'), 'Minha Bolha portátil\n', 'utf8');

const tar = spawnSync(
  'tar',
  ['-a', '-c', '-f', zipPath, '-C', portableRoot, 'Minha Bolha'],
  { stdio: 'inherit' }
);
if (tar.status !== 0) {
  throw new Error('Falha ao criar o ZIP portátil.');
}

// Limpa artefatos de staging: o ZIP é o entregável e o debug do builder
// contém caminhos locais da máquina que não devem ser publicados.
await rm(portableRoot, { recursive: true, force: true });
await rm(path.join(release, 'builder-debug.yml'), { force: true });

console.log(`Portátil pronto: ${zipPath}`);
