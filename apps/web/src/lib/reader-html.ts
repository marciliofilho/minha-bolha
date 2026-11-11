/** HTML e estilos compartilhados pelos leitores internos (novels e notícias). */
export const READER_LANGUAGE_KEY = 'hub.reader.language';

export const READER_LANGUAGES = [
  { value: '', label: 'Original' },
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '中文' }
];

export function readerLanguage(): string {
  try {
    return window.localStorage.getItem(READER_LANGUAGE_KEY) ?? 'pt';
  } catch {
    return 'pt';
  }
}

export function saveReaderLanguage(language: string): void {
  try {
    window.localStorage.setItem(READER_LANGUAGE_KEY, language);
  } catch {
    // Armazenamento indisponível.
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphsOf(text: string): string[] {
  const byBlock = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (byBlock.length > 1) return byBlock;
  return text
    .split(/\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

const READER_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html { scroll-behavior: auto !important; }
  body {
    margin: 0;
    background: #0b0f16;
    color: #e5e7eb;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(17px, 1.05vw, 20px);
    line-height: 1.85;
    scroll-behavior: auto;
    overscroll-behavior: contain;
  }
  article { max-width: 780px; margin: 0 auto; padding: 34px 26px 96px; }
  h1 {
    margin: 0 0 6px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: clamp(20px, 1.5vw, 27px);
    line-height: 1.3;
    color: #f8fafc;
  }
  p { margin: 0 0 1.15em; }
  .meta { margin: 0 0 26px; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #94a3b8; }
  a { color: #7dd3fc; }
  .hint { margin-top: 36px; font-family: system-ui, sans-serif; font-size: 11px; color: #64748b; }
  ::selection { background: #1e3a5f; color: #fff; }
`;

const SCROLL_SCRIPT = `
  let hubScrollDirection = 0;
  let hubScrollFrame = 0;
  let hubScrollLast = 0;
  function hubScrollStep(now) {
    if (!hubScrollDirection) {
      hubScrollFrame = 0;
      hubScrollLast = 0;
      return;
    }
    if (!hubScrollLast) hubScrollLast = now;
    const delta = Math.min(64, Math.max(0, now - hubScrollLast));
    hubScrollLast = now;
    window.scrollBy(0, hubScrollDirection * 0.95 * delta);
    hubScrollFrame = requestAnimationFrame(hubScrollStep);
  }
  function hubStopScroll() {
    hubScrollDirection = 0;
    hubScrollLast = 0;
    if (hubScrollFrame) cancelAnimationFrame(hubScrollFrame);
    hubScrollFrame = 0;
  }
  window.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      hubScrollDirection = event.key === 'ArrowDown' ? 1 : -1;
      if (!hubScrollFrame) hubScrollFrame = requestAnimationFrame(hubScrollStep);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Escape') {
      event.preventDefault();
      parent.postMessage({ type: 'hub-reader-key', key: event.key }, '*');
    }
  });
  window.addEventListener('keyup', function (event) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') hubStopScroll();
  });
  window.addEventListener('blur', hubStopScroll);
`;

export function buildReaderHtml(input: {
  title: string;
  subtitle: string;
  text: string;
  language?: string;
  hint?: string;
}): string {
  const paragraphs = paragraphsOf(input.text)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
  const lang = input.language || 'pt-BR';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${READER_CSS}</style>
</head>
<body>
  <article>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="meta">${escapeHtml(input.subtitle)}</p>
    ${paragraphs}
    <p class="hint">${escapeHtml(input.hint ?? 'Use ↑ / ↓ para rolar. Esc para sair.')}</p>
  </article>
  <script>${SCROLL_SCRIPT}</script>
</body>
</html>`;
}
