import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartNovel,
  nextNovelStartAfter,
  novelCooldownRemainingMs,
  queuePriority,
  NOVEL_MANUAL_COOLDOWN_MS,
  NOVEL_START_SPACING_MS
} from './novel-schedule';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

test('cooldown de novel é de 5 minutos', () => {
  const oneMinuteAgo = new Date(NOW - 60_000).toISOString();
  assert.equal(
    novelCooldownRemainingMs('webnovel', oneMinuteAgo, NOW),
    NOVEL_MANUAL_COOLDOWN_MS - 60_000
  );
  assert.equal(
    novelCooldownRemainingMs('webnovel', new Date(NOW - 5 * 60_000).toISOString(), NOW),
    0
  );
  assert.equal(
    novelCooldownRemainingMs('webnovel', new Date(NOW - 6 * 60_000).toISOString(), NOW),
    0
  );
});

test('cooldown não se aplica a outros tipos nem a datas inválidas', () => {
  const oneMinuteAgo = new Date(NOW - 60_000).toISOString();
  assert.equal(novelCooldownRemainingMs('rss', oneMinuteAgo, NOW), 0);
  assert.equal(novelCooldownRemainingMs('webnovel', null, NOW), 0);
  assert.equal(novelCooldownRemainingMs('webnovel', 'data-invalida', NOW), 0);
  assert.equal(
    novelCooldownRemainingMs('webnovel', new Date(NOW + 60_000).toISOString(), NOW),
    0
  );
});

test('novels só iniciam 2 segundos depois da anterior', () => {
  assert.equal(canStartNovel(NOW, NOW), true);
  assert.equal(canStartNovel(NOW, NOW + 1), false);
  assert.equal(nextNovelStartAfter(NOW), NOW + NOVEL_START_SPACING_MS);
});

test('feeds têm prioridade sobre novels e fontes de mídia', () => {
  assert.equal(queuePriority('youtube', false), 0);
  assert.equal(queuePriority('rss', false), 0);
  assert.equal(queuePriority('custom', false), 0);
  assert.equal(queuePriority('tmdb', true), 1);
  assert.equal(queuePriority('webnovel', false), 2);
  assert.equal(queuePriority('tmdb', false), 3);
});
