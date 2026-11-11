import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChapterFromHtml } from './novel-html';

function longProse(paragraphs = 12): string {
  return Array.from({ length: paragraphs }, (_, index) => `<p>Parágrafo ${index + 1} da cena com detalhes suficientes para formar o capítulo.</p>`).join('');
}

test('extrai conteúdo de um container comum de capítulo', () => {
  const html = `<html><head><title>Capítulo 12 — Teste</title></head><body>
    <nav>Menu</nav>
    <div id="chapterContent">${longProse()}</div>
    <footer>Rodapé</footer>
  </body></html>`;
  const chapter = extractChapterFromHtml(html, 'https://site.com/book/1/chapter-12');
  assert.ok(chapter);
  assert.match(chapter.title, /Capítulo 12/);
  assert.match(chapter.text, /Parágrafo 1/);
  assert.doesNotMatch(chapter.text, /Menu|Rodapé/);
  assert.equal(chapter.finalUrl, 'https://site.com/book/1/chapter-12');
});

test('extrai articleBody de JSON-LD quando não há container', () => {
  const body = 'Texto do capítulo em JSON-LD. '.repeat(20);
  const html = `<html><head><title>Capítulo 3</title>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', articleBody: body })}</script>
    </head><body><div class="layout"></div></body></html>`;
  const chapter = extractChapterFromHtml(html);
  assert.ok(chapter);
  assert.match(chapter.text, /Texto do capítulo em JSON-LD/);
});

test('descarta página de verificação', () => {
  const html = `<html><head><title>Just a moment...</title></head><body>
    <div id="chapterContent">Checking your browser before accessing. enable javascript and cookies.</div>
    </body></html>`;
  assert.equal(extractChapterFromHtml(html), null);
});

test('descarta HTML sem conteúdo de capítulo', () => {
  const html = '<html><head><title>Página inicial</title></head><body><div>Sem capítulo</div></body></html>';
  assert.equal(extractChapterFromHtml(html), null);
});
