/**
 * Identidade do app por idioma.
 *
 * O nome e a arte mudam com o idioma efetivo:
 * - Português (Brasil) → "Minha Bolha"
 * - English/Español/outros → "My Bubble"
 */
import type { AppLanguage } from '@hub/shared';

export interface AppBrand {
  /** Nome exibido na interface, título da janela e aba do navegador. */
  name: string;
  /** Caminho público da arte usada ao lado do nome. */
  logo: string;
  /** Descrição curta usada na meta tag da página. */
  description: string;
}

/** Link de apoio financeiro do projeto. */
export const KOFI_URL = 'https://ko-fi.com/mybubble';

const PT_BR: AppBrand = {
  name: 'Minha Bolha',
  logo: '/branding/minha-bolha.png',
  description: 'Seus feeds, lançamentos e preços de jogos em um só lugar.'
};

const GLOBAL: AppBrand = {
  name: 'My Bubble',
  logo: '/branding/my-bubble.png',
  description: 'Your feeds, releases and game prices in one place.'
};

const GLOBAL_ES: AppBrand = {
  ...GLOBAL,
  description: 'Tus feeds, lanzamientos y precios de juegos en un solo lugar.'
};

/** Nome, arte e descrição do app para o idioma atual. */
export function appBrand(language: AppLanguage): AppBrand {
  if (language === 'pt') return PT_BR;
  if (language === 'es') return GLOBAL_ES;
  return GLOBAL;
}

/**
 * Troca as menções ao antigo nome "Hub" pelo nome atual, preservando nomes de
 * terceiros (ex.: o site "Scribble Hub") e ajustando o artigo em português.
 */
export function brandText(text: string, language: AppLanguage): string {
  if (!text.includes('Hub')) return text;

  // "Scribble Hub" é o nome de um site, não do app.
  let out = text.replace(/\bScribble Hub\b/gi, (match) =>
    match.replace(/Hub$/i, '\u0000SITE\u0000')
  );

  if (language === 'pt') {
    out = out
      .replace(/\bMinha biblioteca do Hub\b/g, 'Minha biblioteca')
      .replace(/\bdo Hub\b/g, 'da Minha Bolha')
      .replace(/\bno Hub\b/g, 'na Minha Bolha')
      .replace(/\bO Hub\b/g, 'A Minha Bolha')
      .replace(/\bo Hub\b/g, 'a Minha Bolha')
      .replace(/\bHub\b/g, 'Minha Bolha');
  } else {
    out = out
      .replace(/\bHub My Library\b/g, 'My Bubble Library')
      .replace(/\bMi biblioteca de Hub\b/g, 'Mi biblioteca')
      .replace(/\bHub\b/g, 'My Bubble');
  }

  return out.replace(/\u0000SITE\u0000/g, 'Hub');
}
