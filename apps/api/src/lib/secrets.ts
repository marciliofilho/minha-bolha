/**
 * Chaves de API: banco local (editáveis pela UI) com fallback para o .env.
 * Os valores nunca são devolvidos pela API — só status e máscara.
 */
import type { SecretId, SecretStatusDto } from '@hub/shared';
import { db } from '../db/database';
import { nowIso } from './dates';

interface SecretDef {
  id: SecretId;
  envVar: string;
  label: string;
}

const DEFS: SecretDef[] = [
  { id: 'tmdb', envVar: 'TMDB_API_KEY', label: 'TMDB' },
  { id: 'steam', envVar: 'STEAM_API_KEY', label: 'Steam' },
  { id: 'ggdeals', envVar: 'GGDEALS_API_KEY', label: 'gg.deals' }
];

export const SECRET_IDS: SecretId[] = DEFS.map((definition) => definition.id);

function definitionOf(id: SecretId): SecretDef {
  const definition = DEFS.find((item) => item.id === id);
  if (!definition) throw new Error(`Chave desconhecida: ${id}`);
  return definition;
}

function databaseValue(envVar: string): string | null {
  const row = db.prepare('SELECT value FROM secrets WHERE key = ?').get(envVar) as
    | { value: string }
    | undefined;
  const value = row?.value?.trim();
  return value ? value : null;
}

function environmentValue(envVar: string): string | null {
  const value = process.env[envVar]?.trim();
  return value ? value : null;
}

function mask(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/** Steam exige uma chave Web API de 32 caracteres hexadecimais. */
export function isValidSecretFormat(id: SecretId, value: string): boolean {
  if (id === 'steam') return /^[0-9A-Fa-f]{32}$/.test(value.trim());
  return true;
}

/** Valor efetivo: banco primeiro, depois .env. */
export function secretValue(id: SecretId): string | null {
  const definition = definitionOf(id);
  return databaseValue(definition.envVar) ?? environmentValue(definition.envVar);
}

export function hasSecret(id: SecretId): boolean {
  return secretValue(id) !== null;
}

export function secretStatus(id: SecretId): SecretStatusDto {
  const definition = definitionOf(id);
  const fromDb = databaseValue(definition.envVar);
  if (fromDb) {
    return {
      id,
      label: definition.label,
      envVar: definition.envVar,
      configured: true,
      source: 'app',
      masked: mask(fromDb),
      formatValid: isValidSecretFormat(id, fromDb)
    };
  }

  const fromEnv = environmentValue(definition.envVar);
  if (fromEnv) {
    return {
      id,
      label: definition.label,
      envVar: definition.envVar,
      configured: true,
      source: 'env',
      masked: mask(fromEnv),
      formatValid: isValidSecretFormat(id, fromEnv)
    };
  }

  return {
    id,
    label: definition.label,
    envVar: definition.envVar,
    configured: false,
    source: null,
    masked: null,
    formatValid: null
  };
}

export function listSecretStatuses(): SecretStatusDto[] {
  return DEFS.map((definition) => secretStatus(definition.id));
}

export function setSecret(id: SecretId, value: string): SecretStatusDto {
  const definition = definitionOf(id);
  db.prepare(
    `INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(definition.envVar, value.trim(), nowIso());
  return secretStatus(id);
}

/** Remove a chave do app; se houver valor no .env, ele volta a valer. */
export function deleteSecret(id: SecretId): SecretStatusDto {
  const definition = definitionOf(id);
  db.prepare('DELETE FROM secrets WHERE key = ?').run(definition.envVar);
  return secretStatus(id);
}
