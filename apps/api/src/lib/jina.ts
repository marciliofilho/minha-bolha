/**
 * Leitor externo (Jina Reader) usado como último recurso de scraping.
 *
 * Ele busca a página do lado do serviço e devolve texto/markdown legível; em
 * muitos casos passa por páginas que bloqueiam o navegador local.
 */
import { createLogger } from './logger';

const log = createLogger('jina');

const TIMEOUT_MS = 15_000;
const CHALLENGE_RE =
  /(executando verifica|verificação de segurança|cf-browser-verification|just a moment\.\.\.|attention required!?\s*\|\s*cloudflare|checking your browser before accessing|enable javascript and cookies|ray id:)/i;

export interface JinaChapter {
  title: string;
  text: string;
}

export async function fetchViaJina(
  url: string,
  timeoutMs = TIMEOUT_MS
): Promise<JinaChapter | null> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: 'text/plain',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      log.warn(`leitor externo respondeu ${response.status}`);
      return null;
    }
    const text = await response.text();
    if (!text || text.length < 300) return null;
    if (CHALLENGE_RE.test(text.slice(0, 3000))) return null;
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const title = (lines[0] ?? '').replace(/^title:\s*/i, '').slice(0, 200);
    // Remove o cabeçalho do leitor (Title/URL/Published) e mantém o conteúdo.
    const marker = text.indexOf('Markdown Content:');
    const body = marker >= 0 ? text.slice(marker + 'Markdown Content:'.length).trim() : text.trim();
    if (body.length < 200) return null;
    return { title, text: body };
  } catch (error) {
    log.warn(
      `leitor externo indisponível: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
