import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeWebnovelUrl,
  chapterSegment,
  isNovelChallengePage,
  isSameChapter,
  isWebnovelUrl,
  toMobileUrl
} from './webnovel-url';

test('canonicaliza URL de livro com slug mantendo o locale', () => {
  assert.equal(
    canonicalizeWebnovelUrl('https://www.webnovel.com/pt/book/shadow-slave_1234567890?foo=1'),
    'https://www.webnovel.com/pt/book/1234567890'
  );
});

test('canonicaliza URL de capítulo preservando o ID do capítulo', () => {
  assert.equal(
    canonicalizeWebnovelUrl(
      'https://www.webnovel.com/book/shadow-slave_1234567890/chapter-42_987654321'
    ),
    'https://www.webnovel.com/pt/book/1234567890/987654321'
  );
});

test('mantém URLs de outros sites intactas', () => {
  assert.equal(
    canonicalizeWebnovelUrl('https://example.com/novel/abc'),
    'https://example.com/novel/abc'
  );
});

test('reconhece apenas hosts da Webnovel', () => {
  assert.equal(isWebnovelUrl('https://webnovel.com/book/1'), true);
  assert.equal(isWebnovelUrl('https://www.webnovel.com/pt/book/1'), true);
  assert.equal(isWebnovelUrl('https://m.webnovel.com/book/1'), true);
  assert.equal(isWebnovelUrl('https://notwebnovel.com/book/1'), false);
  assert.equal(isWebnovelUrl('não é uma url'), false);
});

test('converte a Webnovel para o host móvel', () => {
  assert.equal(
    toMobileUrl('https://www.webnovel.com/pt/book/1234567890/99'),
    'https://m.webnovel.com/pt/book/1234567890/99'
  );
  assert.equal(toMobileUrl('https://example.com/a'), 'https://example.com/a');
});

test('compara capítulos pelo último segmento da URL', () => {
  assert.equal(chapterSegment('https://site.com/novel/a/chapter-1?x=1'), 'chapter-1');
  assert.equal(chapterSegment('url inválida'), null);
  assert.equal(
    isSameChapter('https://site.com/a/chapter-1', 'https://outro.com/b/chapter-1?p=2'),
    true
  );
  assert.equal(
    isSameChapter('https://site.com/a/chapter-1', 'https://site.com/a/chapter-2'),
    false
  );
  assert.equal(isSameChapter('https://site.com/a/', 'https://site.com/b/'), false);
});

test('detecta páginas de desafio sem confundir com prosa do capítulo', () => {
  assert.equal(
    isNovelChallengePage('Just a moment...', 'Checking your browser before accessing'),
    true
  );
  assert.equal(isNovelChallengePage('Capítulo 10', 'Verificação de segurança'), true);

  const prose = `${'Ele esperou por um momento. '.repeat(200)}just a moment...`;
  assert.equal(isNovelChallengePage('Capítulo 10', prose), false);
});
