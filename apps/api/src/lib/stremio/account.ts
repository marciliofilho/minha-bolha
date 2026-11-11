/** Conta do Stremio: status, login único e persistência criptografada do token. */
import type { SourceDto, StremioStatusDto } from '@hub/shared';
import {
  clearStremioLibrary,
  countStremioLibrary,
  deleteStremioAccount,
  getStremioAccount,
  markStremioExpired,
  saveStremioAccount,
  updateStremioLastSync
} from '../../db/repositories/stremio';
import { createSource, listSources, updateSource } from '../../db/repositories/sources';
import { decryptSecret, encryptSecret, isAppSecretConfigured } from '../crypto';
import { fetchStremioLibrary, stremioLogin } from './api';

export function getStremioStatus(): StremioStatusDto {
  const account = getStremioAccount();
  return {
    connected: Boolean(account?.auth_key),
    email: account?.email ?? null,
    expired: account?.expired === 1,
    lastSyncAt: account?.last_sync_at ?? null,
    libraryCount: countStremioLibrary(),
    appSecretConfigured: isAppSecretConfigured()
  };
}

/** Valor efetivo do token; se a descriptografia falhar, marca a sessão expirada. */
export function getStremioAuthKey(): string | null {
  const account = getStremioAccount();
  if (!account?.auth_key) return null;
  try {
    return decryptSecret(account.auth_key);
  } catch {
    markStremioExpired();
    return null;
  }
}

export async function loginStremio(email: string, password: string): Promise<StremioStatusDto> {
  if (!isAppSecretConfigured()) {
    throw new Error('Configure APP_SECRET no .env (mín. 16 caracteres) antes de conectar o Stremio.');
  }
  const result = await stremioLogin(email, password);
  saveStremioAccount(result.email, encryptSecret(result.authKey));
  return getStremioStatus();
}

export async function saveStremioAuthKey(
  authKey: string,
  email: string | null
): Promise<StremioStatusDto> {
  if (!isAppSecretConfigured()) {
    throw new Error('Configure APP_SECRET no .env (mín. 16 caracteres) antes de salvar a chave.');
  }
  // Valida a chave lendo a biblioteca uma vez. Nada é gravado se falhar.
  await fetchStremioLibrary(authKey);
  saveStremioAccount(email, encryptSecret(authKey));
  return getStremioStatus();
}

export function disconnectStremio(): StremioStatusDto {
  deleteStremioAccount();
  clearStremioLibrary();
  return getStremioStatus();
}

export function markStremioSessionExpired(): void {
  markStremioExpired();
}

export function touchStremioLastSync(at: string): void {
  updateStremioLastSync(at);
}

export function findStremioSource(): SourceDto | null {
  return listSources().find((source) => source.type === 'stremio-library') ?? null;
}

/** Cria/ativa a fonte quando conectado; desativa quando desconectado/expirado. */
export function ensureStremioSource(): SourceDto | null {
  const account = getStremioAccount();
  const connected = Boolean(account?.auth_key) && account?.expired !== 1;
  const existing = findStremioSource();

  if (!connected) {
    if (existing?.enabled) updateSource(existing.id, { enabled: false });
    return existing;
  }

  if (existing) {
    if (!existing.enabled) updateSource(existing.id, { enabled: true });
    return existing;
  }

  return createSource({
    type: 'stremio-library',
    name: 'Biblioteca Stremio',
    categoryId: 'other',
    config: { provider: 'stremio' },
    intervalMinutes: 60
  });
}
