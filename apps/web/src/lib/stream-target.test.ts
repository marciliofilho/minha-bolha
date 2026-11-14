import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnimeMetaId } from './stream-target';

test('reconhece IDs de anime dos addons', () => {
  assert.equal(isAnimeMetaId('kitsu:12'), true);
  assert.equal(isAnimeMetaId('mal:21'), true);
  assert.equal(isAnimeMetaId('anilist:1'), true);
  assert.equal(isAnimeMetaId('anidb:2'), true);
  assert.equal(isAnimeMetaId('zeusanime2:abc'), true);
  assert.equal(isAnimeMetaId('zeusanimev2:abc'), true);
});

test('não trata IMDb/TMDB e valores vazios como anime', () => {
  assert.equal(isAnimeMetaId('tt0388629'), false);
  assert.equal(isAnimeMetaId('tmdb:123'), false);
  assert.equal(isAnimeMetaId(''), false);
  assert.equal(isAnimeMetaId(null), false);
  assert.equal(isAnimeMetaId(undefined), false);
});
