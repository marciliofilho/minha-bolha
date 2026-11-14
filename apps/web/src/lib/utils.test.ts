import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeCompact, setAppLanguage } from './utils';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

test('tempo relativo compacto em português', () => {
  setAppLanguage('pt');
  assert.equal(formatRelativeCompact(ago(30_000), NOW), 'agora');
  assert.equal(formatRelativeCompact(ago(30 * 60_000), NOW), '30 min');
  assert.equal(formatRelativeCompact(ago(60 * 60_000), NOW), '1 h');
  assert.equal(formatRelativeCompact(ago(25 * 60 * 60_000), NOW), '1 dia');
  assert.equal(formatRelativeCompact(ago(2 * 24 * 60 * 60_000), NOW), '2 dias');
  assert.equal(formatRelativeCompact(ago(30 * 24 * 60 * 60_000), NOW), '1 mês');
  assert.equal(formatRelativeCompact(ago(365 * 24 * 60 * 60_000), NOW), '1 ano');
});

test('tempo relativo lida com data inválida e futura', () => {
  setAppLanguage('pt');
  assert.equal(formatRelativeCompact(null, NOW), '—');
  assert.equal(formatRelativeCompact('data-invalida', NOW), '—');
  assert.equal(formatRelativeCompact(new Date(NOW + 60_000).toISOString(), NOW), 'agora');
});

test('tempo relativo compacto em inglês e espanhol', () => {
  setAppLanguage('en');
  assert.equal(formatRelativeCompact(ago(24 * 60 * 60_000), NOW), '1 day');
  assert.equal(formatRelativeCompact(ago(2 * 24 * 60 * 60_000), NOW), '2 days');
  assert.equal(formatRelativeCompact(ago(60 * 60_000), NOW), '1 h');

  setAppLanguage('es');
  assert.equal(formatRelativeCompact(ago(24 * 60 * 60_000), NOW), '1 día');
  assert.equal(formatRelativeCompact(ago(2 * 24 * 60 * 60_000), NOW), '2 días');
  assert.equal(formatRelativeCompact(ago(60 * 60_000), NOW), '1 h');

  setAppLanguage('pt');
});
