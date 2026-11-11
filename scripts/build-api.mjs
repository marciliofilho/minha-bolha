/**
 * Compila a API para um único arquivo ESM, executável pelo Node embutido no
 * Electron. As migrations SQL são copiadas ao lado do bundle.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'apps', 'api', 'dist');
const entry = path.join(root, 'apps', 'api', 'src', 'index.ts');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile: path.join(outDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  // Módulos nativos/opcionais ficam fora do bundle.
  external: ['utp-native', 'ffmpeg-static', 'ffprobe-static'],
  alias: {
    // Import estático do polyfill vira require dinâmico resolvido em runtime.
    'node-datachannel': path.join(root, 'apps', 'api', 'src', 'shims', 'node-datachannel.ts')
  },
  banner: {
    js: "import { createRequire as __hubCreateRequire } from 'node:module'; const require = __hubCreateRequire(import.meta.url);"
  }
});

await cp(
  path.join(root, 'apps', 'api', 'src', 'db', 'migrations'),
  path.join(outDir, 'migrations'),
  { recursive: true }
);

// Nativo exigido pelo WebTorrent/WebRTC; precisa ficar fora do bundle.
// Fica em `vendor` porque o electron-builder ignora pastas `node_modules`.
// Copiamos só o runtime (dist CJS + binário), sem fontes, testes ou docs.
const nativeRoot = path.join(root, 'node_modules', 'node-datachannel');
const nativeOut = path.join(outDir, 'vendor', 'node-datachannel');
await mkdir(nativeOut, { recursive: true });
await cp(path.join(nativeRoot, 'package.json'), path.join(nativeOut, 'package.json'));
await cp(path.join(nativeRoot, 'LICENSE'), path.join(nativeOut, 'LICENSE'));
await cp(path.join(nativeRoot, 'dist', 'cjs'), path.join(nativeOut, 'dist', 'cjs'), {
  recursive: true,
  filter: (source) => !source.endsWith('.map')
});
await cp(
  path.join(nativeRoot, 'build', 'Release'),
  path.join(nativeOut, 'build', 'Release'),
  { recursive: true }
);

console.log('API compilada em apps/api/dist');
