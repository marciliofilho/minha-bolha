/**
 * Criptografia do token do Stremio (AES-256-GCM).
 * A chave vem de APP_SECRET no .env; nunca é persistida no banco.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';
const SALT = 'hub-stremio-v1';

export function isAppSecretConfigured(): boolean {
  return Boolean(process.env.APP_SECRET && process.env.APP_SECRET.trim().length >= 16);
}

function derivedKey(): Buffer {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error('APP_SECRET ausente ou menor que 16 caracteres.');
  }
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivText, tagText, dataText] = payload.split(':');
  if (version !== VERSION || !ivText || !tagText || !dataText) {
    throw new Error('Payload de segredo inválido.');
  }

  const decipher = createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8');
}
