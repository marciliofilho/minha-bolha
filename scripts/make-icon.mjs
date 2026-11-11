/**
 * Gera build/icon.ico a partir da arte PT-BR (formato ICO com PNG 256x256).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const png = readFileSync(path.join(root, 'apps/web/public/branding/minha-bolha.png'));
const outDir = path.join(root, 'apps/desktop/build');
mkdirSync(outDir, { recursive: true });

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // tipo: ícone
header.writeUInt16LE(1, 4); // quantidade
header.writeUInt8(0, 6); // largura 256
header.writeUInt8(0, 7); // altura 256
header.writeUInt8(0, 8); // cores
header.writeUInt8(0, 9); // reservado
header.writeUInt16LE(1, 10); // planos
header.writeUInt16LE(32, 12); // bits por pixel
header.writeUInt32LE(png.length, 14); // tamanho da imagem
header.writeUInt32LE(22, 18); // offset da imagem

writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, png]));
console.log('apps/desktop/build/icon.ico gerado');
