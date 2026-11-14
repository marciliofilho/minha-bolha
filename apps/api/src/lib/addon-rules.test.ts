import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticForStatus } from './stremio/addons/diagnostics';
import { isCacheableStreamList } from './stremio/addons/cache-policy';
import { streamQueryTypes } from './stremio/addons/query';

test('anime consulta anime e series; os demais usam o próprio tipo', () => {
  assert.deepEqual(streamQueryTypes('anime'), ['anime', 'series']);
  assert.deepEqual(streamQueryTypes('series'), ['series']);
  assert.deepEqual(streamQueryTypes('movie'), ['movie']);
});

test('status HTTP vira um diagnóstico curto', () => {
  assert.equal(diagnosticForStatus(401), 'auth');
  assert.equal(diagnosticForStatus(403), 'blocked');
  assert.equal(diagnosticForStatus(404), 'not_found');
  assert.equal(diagnosticForStatus(410), 'not_found');
  assert.equal(diagnosticForStatus(429), 'rate_limited');
  assert.equal(diagnosticForStatus(500), 'http');
  assert.equal(diagnosticForStatus(0), 'unknown');
});

test('lista vazia de streams não entra no cache', () => {
  assert.equal(isCacheableStreamList([]), false);
  assert.equal(isCacheableStreamList(null), false);
  assert.equal(isCacheableStreamList(undefined), false);
  assert.equal(isCacheableStreamList([{ id: 'a' }]), true);
});
