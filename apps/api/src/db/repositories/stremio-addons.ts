/** Repositório dos addons cadastrados (URL do manifest criptografada). */
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../database';
import type { StremioAddonRow } from '../types';
import { nowIso } from '../../lib/dates';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { parseAddonManifest, type AddonManifest } from '../../lib/stremio/addons/manifest';

export function addonUrlHash(transportUrl: string): string {
  return createHash('sha256').update(transportUrl).digest('hex');
}

export function listAddonRows(onlyEnabled = false): StremioAddonRow[] {
  const where = onlyEnabled ? 'WHERE enabled = 1' : '';
  return db
    .prepare(`SELECT * FROM stremio_addons ${where} ORDER BY priority ASC, created_at ASC`)
    .all() as unknown as StremioAddonRow[];
}

export function getAddonRow(id: string): StremioAddonRow | null {
  const row = db.prepare('SELECT * FROM stremio_addons WHERE id = ?').get(id) as
    | StremioAddonRow
    | undefined;
  return row ?? null;
}

export function findAddonByUrl(transportUrl: string): StremioAddonRow | null {
  const row = db
    .prepare('SELECT * FROM stremio_addons WHERE url_hash = ?')
    .get(addonUrlHash(transportUrl)) as StremioAddonRow | undefined;
  return row ?? null;
}

export function nextAddonPriority(): number {
  const row = db.prepare('SELECT COALESCE(MAX(priority), 0) AS value FROM stremio_addons').get() as {
    value: number;
  };
  return Number(row.value) + 10;
}

export function createAddonRow(input: {
  transportUrl: string;
  manifest: AddonManifest;
  name?: string;
  priority?: number;
}): StremioAddonRow {
  const id = randomUUID();
  const now = nowIso();
  const priority = input.priority ?? nextAddonPriority();
  db.prepare(
    `INSERT INTO stremio_addons (
       id, url_hash, transport_url_enc, addon_id, name, version, description,
       manifest_json, enabled, priority, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    id,
    addonUrlHash(input.transportUrl),
    encryptSecret(input.transportUrl),
    input.manifest.id,
    input.name?.trim() || input.manifest.name,
    input.manifest.version,
    input.manifest.description ?? null,
    JSON.stringify(input.manifest),
    priority,
    now,
    now
  );
  return getAddonRow(id) as StremioAddonRow;
}

export function updateAddonRow(
  id: string,
  patch: {
    transportUrl?: string;
    manifest?: AddonManifest;
    name?: string;
    enabled?: boolean;
    priority?: number;
  }
): StremioAddonRow | null {
  const current = getAddonRow(id);
  if (!current) return null;

  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.transportUrl !== undefined) {
    fields.push('url_hash = ?', 'transport_url_enc = ?');
    values.push(addonUrlHash(patch.transportUrl), encryptSecret(patch.transportUrl));
  }
  if (patch.manifest !== undefined) {
    fields.push('addon_id = ?', 'version = ?', 'description = ?', 'manifest_json = ?');
    values.push(
      patch.manifest.id,
      patch.manifest.version,
      patch.manifest.description ?? null,
      JSON.stringify(patch.manifest)
    );
    if (patch.name === undefined) {
      fields.push('name = ?');
      values.push(patch.manifest.name);
    }
  }
  if (patch.name !== undefined) {
    fields.push('name = ?');
    values.push(patch.name.trim() || current.name);
  }
  if (patch.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?');
    values.push(patch.priority);
  }

  if (fields.length === 0) return current;

  fields.push('updated_at = ?');
  values.push(nowIso());
  db.prepare(`UPDATE stremio_addons SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getAddonRow(id);
}

export function deleteAddonRow(id: string): boolean {
  const result = db.prepare('DELETE FROM stremio_addons WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

/** Reordena por prioridade (menor número = mais prioritário). */
export function reorderAddonRows(ids: string[]): void {
  const statement = db.prepare('UPDATE stremio_addons SET priority = ?, updated_at = ? WHERE id = ?');
  const now = nowIso();
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => statement.run(index * 10, now, id));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setAddonTestState(
  id: string,
  input: { ok: boolean; error: string | null; summary: unknown }
): void {
  db.prepare(
    `UPDATE stremio_addons
     SET last_test_at = ?, last_test_ok = ?, last_test_error = ?, last_test_summary = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    nowIso(),
    input.ok ? 1 : 0,
    input.error,
    input.summary === undefined ? null : JSON.stringify(input.summary),
    nowIso(),
    id
  );
}

export function getAddonTransportUrl(row: StremioAddonRow): string {
  return decryptSecret(row.transport_url_enc);
}

export function getAddonManifest(row: StremioAddonRow): AddonManifest {
  return parseAddonManifest(JSON.parse(row.manifest_json) as unknown);
}
