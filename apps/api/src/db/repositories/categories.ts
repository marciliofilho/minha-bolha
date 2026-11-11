/** Repositório de categorias. */
import { db } from '../database';
import type { CategoryDefinition } from '@hub/shared';
import type { CategoryRow } from '../types';
import { toCategoryDto } from '../mappers';

export function listCategories(): CategoryDefinition[] {
  const rows = db
    .prepare('SELECT * FROM categories ORDER BY sort_order ASC, label ASC')
    .all() as unknown as CategoryRow[];
  return rows.map(toCategoryDto);
}

export function getCategory(id: string): CategoryDefinition | null {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as unknown as CategoryRow | undefined;
  return row ? toCategoryDto(row) : null;
}

export function upsertCustomCategory(input: {
  id: string;
  label: string;
  icon?: string;
  color?: string;
}): CategoryDefinition {
  const sortOrder = 100 + Math.floor(Math.random() * 800);
  db.prepare(
    `INSERT INTO categories (id, label, icon, color, sort_order, is_system)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, icon = excluded.icon, color = excluded.color`
  ).run(input.id, input.label, input.icon ?? 'rss', input.color ?? '#8b96a8', sortOrder);
  return getCategory(input.id) as CategoryDefinition;
}

export function countCategories(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM categories').get() as { total: number };
  return Number(row.total);
}
