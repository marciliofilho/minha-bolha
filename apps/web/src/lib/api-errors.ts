/**
 * Traduz as mensagens técnicas mais comuns devolvidas pela API. Mensagens
 * desconhecidas de conectores/sites permanecem no idioma de origem para não
 * esconder o diagnóstico real.
 */
import { getAppLanguage } from '@/lib/utils';

type Locale = 'en' | 'es';
type Translation = Record<Locale, string>;

const MESSAGES: Record<string, Translation> = {
  'Dados inválidos.': { en: 'Invalid data.', es: 'Datos inválidos.' },
  'JSON inválido no corpo da requisição.': {
    en: 'Invalid JSON in the request body.',
    es: 'JSON inválido en el cuerpo de la solicitud.'
  },
  'O servidor local não respondeu. Verifique se a API está rodando (npm run dev) e tente novamente.':
    {
      en: 'The local server did not respond. Check that the API is running (npm run dev) and try again.',
      es: 'El servidor local no respondió. Comprueba que la API está en ejecución (npm run dev) e inténtalo de nuevo.'
    },
  'Fonte não encontrada.': { en: 'Source not found.', es: 'Fuente no encontrada.' },
  'Item não encontrado.': { en: 'Item not found.', es: 'Elemento no encontrado.' },
  'Jogo não encontrado.': { en: 'Game not found.', es: 'Juego no encontrado.' },
  'Categoria inexistente.': { en: 'Category does not exist.', es: 'La categoría no existe.' },
  'Esta fonte não é uma novel da Webnovel.': {
    en: 'This source is not a Webnovel novel.',
    es: 'Esta fuente no es una novela de Webnovel.'
  },
  'A fonte não tem o link da novel.': {
    en: 'The source has no novel link.',
    es: 'La fuente no tiene el enlace de la novela.'
  },
  'Informe a URL do capítulo.': {
    en: 'Enter the chapter URL.',
    es: 'Indica la URL del capítulo.'
  },
  'URL de capítulo inválida.': {
    en: 'Invalid chapter URL.',
    es: 'URL de capítulo inválida.'
  },
  'Informe a URL da notícia.': { en: 'Enter the news URL.', es: 'Indica la URL de la noticia.' },
  'URL de notícia inválida.': { en: 'Invalid news URL.', es: 'URL de noticia inválida.' },
  'Use um endereço http:// ou https://.': {
    en: 'Use an http:// or https:// address.',
    es: 'Usa una dirección http:// o https://.'
  },
  'Este tipo de fonte não aceita URL para resolver.': {
    en: 'This source type does not accept a URL to resolve.',
    es: 'Este tipo de fuente no acepta una URL para resolver.'
  },
  'Este jogo já está na sua biblioteca.': {
    en: 'This game is already in your library.',
    es: 'Este juego ya está en tu biblioteca.'
  },
  'Já existe uma categoria do sistema com esse nome.': {
    en: 'A system category with this name already exists.',
    es: 'Ya existe una categoría del sistema con ese nombre.'
  },
  'Nome de categoria inválido.': {
    en: 'Invalid category name.',
    es: 'Nombre de categoría inválido.'
  },
  'Conecte sua conta do Stremio primeiro.': {
    en: 'Connect your Stremio account first.',
    es: 'Conecta primero tu cuenta de Stremio.'
  },
  'O Stremio só pode ser gerenciado a partir do próprio computador.': {
    en: 'Stremio can only be managed from this computer.',
    es: 'Stremio solo se puede gestionar desde este ordenador.'
  },
  'Os addons só podem ser gerenciados a partir do próprio computador.': {
    en: 'Addons can only be managed from this computer.',
    es: 'Los addons solo se pueden gestionar desde este ordenador.'
  },
  'Os torrents só podem ser usados a partir do próprio computador.': {
    en: 'Torrents can only be used from this computer.',
    es: 'Los torrents solo se pueden usar desde este ordenador.'
  },
  'O progresso só pode ser acessado do próprio computador.': {
    en: 'Playback progress can only be accessed from this computer.',
    es: 'El progreso solo se puede acceder desde este ordenador.'
  },
  'As chaves só podem ser gerenciadas a partir do próprio computador.': {
    en: 'Keys can only be managed from this computer.',
    es: 'Las claves solo se pueden gestionar desde este ordenador.'
  },
  'Chave desconhecida.': { en: 'Unknown key.', es: 'Clave desconocida.' },
  'Provedor inválido. Use "tmdb" ou "anilist".': {
    en: 'Invalid provider. Use "tmdb" or "anilist".',
    es: 'Proveedor inválido. Usa "tmdb" o "anilist".'
  },
  'Digite pelo menos 2 caracteres para buscar.': {
    en: 'Type at least 2 characters to search.',
    es: 'Escribe al menos 2 caracteres para buscar.'
  },
  'Busca grande demais.': { en: 'Search query is too long.', es: 'Búsqueda demasiado grande.' },
  'Datas devem estar no formato YYYY-MM-DD.': {
    en: 'Dates must use the YYYY-MM-DD format.',
    es: 'Las fechas deben usar el formato YYYY-MM-DD.'
  },
  'Intervalo máximo de 370 dias.': {
    en: 'Maximum range is 370 days.',
    es: 'El intervalo máximo es de 370 días.'
  },
  'Tipo inválido.': { en: 'Invalid type.', es: 'Tipo inválido.' },
  'ID do título inválido.': { en: 'Invalid title ID.', es: 'ID del título inválido.' },
  'Arquivo do torrent vazio.': { en: 'Torrent file is empty.', es: 'El archivo del torrent está vacío.' },
  'Range inválido.': { en: 'Invalid range.', es: 'Rango inválido.' },
  'Range fora do arquivo.': { en: 'Range is outside the file.', es: 'Rango fuera del archivo.' },
  'Segmento não encontrado.': { en: 'Segment not found.', es: 'Segmento no encontrado.' },
  'Sessão não encontrada.': { en: 'Session not found.', es: 'Sesión no encontrada.' },
  'Não foi possível ler o arquivo do torrent.': {
    en: 'Could not read the torrent file.',
    es: 'No se pudo leer el archivo del torrent.'
  },
  'Falha ao montar o HLS.': { en: 'Could not build the HLS.', es: 'Fallo al montar el HLS.' },
  'Falha ao gerar o segmento.': { en: 'Could not generate the segment.', es: 'Fallo al generar el segmento.' },
  'Falha ao falar com o Stremio.': {
    en: 'Could not communicate with Stremio.',
    es: 'No se pudo comunicar con Stremio.'
  },
  'Falha ao processar o addon.': { en: 'Could not process the addon.', es: 'Fallo al procesar el addon.' },
  'Falha ao baixar a legenda.': { en: 'Could not download the subtitle.', es: 'Fallo al descargar el subtítulo.' },
  'Idioma de tradução não suportado.': {
    en: 'Translation language not supported.',
    es: 'Idioma de traducción no compatible.'
  },
  'Informe um endereço para abrir.': {
    en: 'Enter an address to open.',
    es: 'Indica una dirección para abrir.'
  },
  'Endereço inválido.': { en: 'Invalid address.', es: 'Dirección inválida.' },
  'Ação de navegação inválida.': {
    en: 'Invalid browser action.',
    es: 'Acción de navegación inválida.'
  },
  'Coordenadas inválidas.': { en: 'Invalid coordinates.', es: 'Coordenadas inválidas.' },
  'Rolagem inválida.': { en: 'Invalid scroll.', es: 'Desplazamiento inválido.' },
  'Tecla inválida.': { en: 'Invalid key.', es: 'Tecla inválida.' },
  'Texto vazio.': { en: 'Empty text.', es: 'Texto vacío.' },
  'Entrada inválida.': { en: 'Invalid input.', es: 'Entrada inválida.' },
  'Não foi possível salvar a fonte da Steam.': {
    en: 'Could not save the Steam source.',
    es: 'No se pudo guardar la fuente de Steam.'
  },
  'Não foi possível criar a fonte de preços.': {
    en: 'Could not create the price source.',
    es: 'No se pudo crear la fuente de precios.'
  },
  'Não foi possível criar a fonte da biblioteca.': {
    en: 'Could not create the library source.',
    es: 'No se pudo crear la fuente de la biblioteca.'
  },
  'Não encontrei um título de exemplo (nem catálogo, nem biblioteca).': {
    en: 'I could not find a sample title (neither catalog nor library).',
    es: 'No encontré un título de ejemplo (ni catálogo ni biblioteca).'
  },
  'Este addon não declara o recurso "stream".': {
    en: 'This addon does not declare the "stream" resource.',
    es: 'Este addon no declara el recurso "stream".'
  },
  'O addon devolveu uma resposta que não é JSON.': {
    en: 'The addon returned a response that is not JSON.',
    es: 'El addon devolvió una respuesta que no es JSON.'
  }
};

const PATTERNS: Array<{
  regex: RegExp;
  translate: (match: RegExpMatchArray, locale: Locale) => string;
}> = [
  {
    regex: /^Falha na requisição \(HTTP (\d+)\)\.$/,
    translate: (match, locale) =>
      locale === 'en' ? `Request failed (HTTP ${match[1]}).` : `Fallo en la solicitud (HTTP ${match[1]}).`
  },
  {
    regex: /^O tipo "(.+)" ainda não está disponível nesta fase\.$/,
    translate: (match, locale) =>
      locale === 'en'
        ? `The type "${match[1]}" is not available yet.`
        : `El tipo "${match[1]}" aún no está disponible.`
  },
  {
    regex: /^Este título já está sendo acompanhado por "(.+)"\.$/,
    translate: (match, locale) =>
      locale === 'en'
        ? `This title is already tracked by "${match[1]}".`
        : `Este título ya está siendo seguido por "${match[1]}".`
  },
  {
    regex: /^Não foi possível carregar o capítulo\. ([\s\S]+)$/,
    translate: (match, locale) =>
      locale === 'en'
        ? `Could not load the chapter. ${match[1]}`
        : `No se pudo cargar el capítulo. ${match[1]}`
  },
  {
    regex: /^Não foi possível carregar a notícia\. ([\s\S]+)$/,
    translate: (match, locale) =>
      locale === 'en'
        ? `Could not load the news item. ${match[1]}`
        : `No se pudo cargar la noticia. ${match[1]}`
  },
  {
    regex: /^Não foi possível traduzir agora\. ([\s\S]+)$/,
    translate: (match, locale) =>
      locale === 'en'
        ? `Could not translate right now. ${match[1]}`
        : `No se pudo traducir ahora. ${match[1]}`
  }
];

export function localizeApiMessage(message: string, _code?: string, _status?: number): string {
  const language = getAppLanguage();
  if (language === 'pt') return message;

  const exact = MESSAGES[message];
  if (exact) return exact[language];

  for (const pattern of PATTERNS) {
    const match = message.match(pattern.regex);
    if (match) return pattern.translate(match, language);
  }

  return message;
}
