/**
 * Dados fictícios para testar a interface sem depender da rede.
 * Todas as fontes criadas aqui têm is_demo = 1 e podem ser removidas em
 * Configurações → Dados de demonstração.
 */
import { randomUUID } from 'node:crypto';
import { db } from './db/database';
import { countDemoSources, countSources, deleteDemoSources } from './db/repositories/sources';
import { countDemoGames, deleteDemoGames, getGameByAppid } from './db/repositories/games';
import { upsertCustomCategory } from './db/repositories/categories';
import { addDaysToDate, dateInZone, nowIso } from './lib/dates';
import { env } from './config/env';

interface DemoSource {
  key: string;
  type: 'youtube' | 'rss';
  name: string;
  categoryId: string;
  config: Record<string, unknown>;
}

const DEMO_SOURCES: DemoSource[] = [
  {
    key: 'yt-tech',
    type: 'youtube',
    name: 'Demo · Tech em Vídeo',
    categoryId: 'youtube',
    config: {
      demo: true,
      channelId: 'UCsBjURrPoezykLs9EqgamOA',
      channelUrl: 'https://www.youtube.com/@Fireship',
      input: 'https://www.youtube.com/@Fireship'
    }
  },
  {
    key: 'yt-dev',
    type: 'youtube',
    name: 'Demo · Dev Talks',
    categoryId: 'youtube',
    config: {
      demo: true,
      channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
      channelUrl: 'https://www.youtube.com/@GoogleDevelopers',
      input: 'https://www.youtube.com/@GoogleDevelopers'
    }
  },
  {
    key: 'news',
    type: 'rss',
    name: 'Demo · Notícias Tech',
    categoryId: 'news',
    config: { demo: true, url: 'https://www.theverge.com/rss/index.xml', siteUrl: 'https://www.theverge.com' }
  },
  {
    key: 'novel',
    type: 'rss',
    name: 'Demo · Novel Tracker',
    categoryId: 'novel',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  },
  {
    key: 'anime',
    type: 'rss',
    name: 'Demo · Anime News',
    categoryId: 'anime',
    config: { demo: true, url: 'https://www.animenewsnetwork.com/all/rss.xml' }
  },
  {
    key: 'movie',
    type: 'rss',
    name: 'Demo · Cinema',
    categoryId: 'movie',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  },
  {
    key: 'series',
    type: 'rss',
    name: 'Demo · Séries',
    categoryId: 'series',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  },
  {
    key: 'game',
    type: 'rss',
    name: 'Demo · Games',
    categoryId: 'game',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  },
  {
    key: 'other',
    type: 'rss',
    name: 'Demo · Outros Links',
    categoryId: 'other',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  },
  {
    key: 'podcast',
    type: 'rss',
    name: 'Demo · Podcasts',
    categoryId: 'podcasts',
    config: { demo: true, url: 'https://hnrss.org/frontpage' }
  }
];

interface DemoItem {
  source: string;
  categoryId?: string;
  kind: 'video' | 'chapter' | 'episode' | 'release' | 'article' | 'price_drop' | 'other';
  title: string;
  description: string;
  author: string;
  thumbnail?: string | null;
  /** Minutos atrás (para ordenar o feed). */
  minutesAgo: number;
  isRead?: boolean;
  isFavorite?: boolean;
  isWatchLater?: boolean;
}

const DEMO_ITEMS: DemoItem[] = [
  // YouTube
  {
    source: 'yt-tech',
    kind: 'video',
    title: '7 padrões de arquitetura que todo dev deveria conhecer',
    description: 'Uma passada rápida por padrões que aparecem em quase todo sistema grande — e quando NÃO usá-los.',
    author: 'Tech em Vídeo',
    thumbnail: 'https://i.ytimg.com/vi/iw9SZgyahqg/hqdefault.jpg',
    minutesAgo: 18
  },
  {
    source: 'yt-tech',
    kind: 'video',
    title: 'Seu bundle está enorme? Veja como eu reduzi 68%',
    description: 'Análise real de um app React com code splitting, tree shaking e troca de dependências.',
    author: 'Tech em Vídeo',
    thumbnail: 'https://i.ytimg.com/vi/k2ruCf_z75I/hqdefault.jpg',
    minutesAgo: 1_440,
    isRead: true
  },
  {
    source: 'yt-dev',
    kind: 'video',
    title: 'TypeScript 5.9 na prática: o que muda no dia a dia',
    description: 'Novidades de tipagem, inferência e performance do compilador explicadas com exemplos.',
    author: 'Dev Talks',
    thumbnail: 'https://i.ytimg.com/vi/rsOiZE19RVo/hqdefault.jpg',
    minutesAgo: 3_200,
    isFavorite: true
  },
  {
    source: 'yt-dev',
    kind: 'video',
    title: 'Construindo um app offline-first em 30 minutos',
    description: 'IndexedDB, fila de sincronização e resolução de conflitos sem drama.',
    author: 'Dev Talks',
    thumbnail: 'https://i.ytimg.com/vi/cv8tEbKtEvk/hqdefault.jpg',
    minutesAgo: 6_100,
    isRead: true
  },
  {
    source: 'yt-tech',
    kind: 'video',
    title: 'O melhor notebook para programar em 2026',
    description: 'Testes de bateria, tela, teclado e desempenho em builds grandes.',
    author: 'Tech em Vídeo',
    thumbnail: 'https://i.ytimg.com/vi/nEaJMdM1djM/hqdefault.jpg',
    minutesAgo: 9_800,
    isRead: true
  },
  {
    source: 'yt-dev',
    kind: 'video',
    title: 'Por que seu teste de integração está lento',
    description: 'Um diagnóstico honesto sobre banco em memória, fixtures e paralelismo.',
    author: 'Dev Talks',
    thumbnail: 'https://i.ytimg.com/vi/ID6vEy94j7c/hqdefault.jpg',
    minutesAgo: 13_500,
    isRead: true
  },

  // Novels
  {
    source: 'novel',
    kind: 'chapter',
    title: 'Capítulo 412 — O Retorno do Lorde das Sombras',
    description: 'A aliança se rompe e o protagonista finalmente revela o que guardava desde o capítulo 300.',
    author: 'Sombra Eterna',
    minutesAgo: 42
  },
  {
    source: 'novel',
    kind: 'chapter',
    title: 'Capítulo 88 — Crônicas da Lua Quebrada',
    description: 'Luna chega à torre e descobre que o mapa estava incompleto desde o início.',
    author: 'Crônicas da Lua',
    minutesAgo: 2_200
  },
  {
    source: 'novel',
    kind: 'chapter',
    title: 'Capítulo 1203 — Caminho do Imortal',
    description: 'O mestre aceita um discípulo improvável e o cultivo muda de direção.',
    author: 'Caminho do Imortal',
    minutesAgo: 5_400,
    isRead: true
  },
  {
    source: 'novel',
    kind: 'chapter',
    title: 'Capítulo 34 — A Biblioteca de Vidro',
    description: 'Cada livro lido apaga uma lembrança. Ela decide ler mesmo assim.',
    author: 'Biblioteca de Vidro',
    minutesAgo: 10_200,
    isRead: true
  },

  // Anime
  {
    source: 'anime',
    kind: 'episode',
    title: 'Frieren: Além da Jornada — episódio 12 (final de temporada)',
    description: 'O arco da cidade de Auberst fecha com uma despedida que já entrou para as melhores do ano.',
    author: 'Anime News',
    thumbnail: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-ivXNJ23SM1xB.jpg',
    minutesAgo: 95,
    isFavorite: true
  },
  {
    source: 'anime',
    kind: 'episode',
    title: 'Dandadan — episódio 5 já disponível',
    description: 'A batalha contra o espírito do túnel ganha um ritmo absurdo e visual impecável.',
    author: 'Anime News',
    minutesAgo: 2_600
  },
  {
    source: 'anime',
    kind: 'episode',
    title: 'Solo Leveling — episódio 3 disponível',
    description: 'A dungeon dupla coloca o protagonista contra algo muito acima do nível esperado.',
    author: 'Anime News',
    minutesAgo: 7_800,
    isRead: true
  },
  {
    source: 'anime',
    kind: 'release',
    title: 'Novo trailer: filme de Chainsaw Man ganha data',
    description: 'Arco da Reze chega aos cinemas com estreia internacional marcada.',
    author: 'Anime News',
    minutesAgo: 11_600,
    isRead: true
  },

  // Filmes
  {
    source: 'movie',
    kind: 'release',
    title: 'Duna — Parte Três: primeiro teaser divulgado',
    description: 'A continuação adapta a segunda metade do livro e chega aos cinemas em 2027.',
    author: 'Cinema',
    thumbnail: 'https://image.tmdb.org/t/p/w780/eZ239CUp1d6OryZEBPnO2n87gMG.jpg',
    minutesAgo: 130,
    isWatchLater: true
  },
  {
    source: 'movie',
    kind: 'release',
    title: 'A Última Fronteira estreia nesta quinta',
    description: 'Ficção científica nacional dirigida por uma estreante ganha distribuição internacional.',
    author: 'Cinema',
    minutesAgo: 4_800
  },
  {
    source: 'movie',
    kind: 'article',
    title: 'Crítica: o melhor filme de animação do ano',
    description: 'Uma história pequena contada com um cuidado visual que merece ser visto no cinema.',
    author: 'Cinema',
    minutesAgo: 9_100,
    isRead: true
  },

  // Séries
  {
    source: 'series',
    kind: 'episode',
    title: 'Severance — S2E4 já disponível',
    description: 'O episódio responde uma pergunta antiga e cria três novas. Discussão sem spoilers no link.',
    author: 'Séries',
    thumbnail: 'https://image.tmdb.org/t/p/w780/ixgFmf1X59PUZam2qbAfskx2gQr.jpg',
    minutesAgo: 210,
    isFavorite: true
  },
  {
    source: 'series',
    kind: 'episode',
    title: 'The Bear — episódio 7 chega ao streaming',
    description: 'Um episódio em plano único que muda o tom da temporada inteira.',
    author: 'Séries',
    minutesAgo: 3_900
  },
  {
    source: 'series',
    kind: 'release',
    title: 'Renovada para a 3ª temporada',
    description: 'A produção começa no início do ano que vem, com o mesmo elenco principal.',
    author: 'Séries',
    minutesAgo: 8_400,
    isRead: true
  },

  // Jogos
  {
    source: 'game',
    kind: 'price_drop',
    title: 'Cyberpunk 2077 com 70% de desconto na Steam',
    description: 'Edição completa por R$ 89,90 — o menor preço registrado até hoje.',
    author: 'Games',
    thumbnail: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg',
    minutesAgo: 55,
    isFavorite: true
  },
  {
    source: 'game',
    kind: 'price_drop',
    title: 'Hades II entra em promoção histórica',
    description: 'Early access com 35% de desconto; o preço não chegava a esse valor desde o lançamento.',
    author: 'Games',
    thumbnail: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145350/header.jpg',
    minutesAgo: 1_900
  },
  {
    source: 'game',
    kind: 'price_drop',
    title: 'Elden Ring: Shadow of the Erdtree por R$ 99,90',
    description: 'A expansão bateu o menor preço em lojas oficiais. Keyshops estão ainda mais baratas.',
    author: 'Games',
    thumbnail: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg',
    minutesAgo: 6_700,
    isWatchLater: true
  },
  {
    source: 'game',
    kind: 'article',
    title: 'Baldur\'s Gate 3 atinge a mínima histórica',
    description: 'Monitoramos o preço há 14 meses — este é o menor valor já visto.',
    author: 'Games',
    thumbnail: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/header.jpg',
    minutesAgo: 12_000,
    isRead: true
  },

  // Notícias
  {
    source: 'news',
    kind: 'article',
    title: 'Node.js 26 chega com suporte nativo a SQLite',
    description: 'A novidade elimina dependências nativas em projetos pequenos e simplifica o setup local.',
    author: 'Notícias Tech',
    thumbnail:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=640&q=70',
    minutesAgo: 25
  },
  {
    source: 'news',
    kind: 'article',
    title: 'Novo padrão de CSS promete acabar com media queries',
    description: 'Container queries e novas funções de layout mudam a forma de escrever componentes responsivos.',
    author: 'Notícias Tech',
    thumbnail:
      'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=640&q=70',
    minutesAgo: 1_100
  },
  {
    source: 'news',
    kind: 'article',
    title: 'Pesquisadores encontram falha em biblioteca amplamente usada',
    description: 'Correção já disponível; projetos devem atualizar a dependência o quanto antes.',
    author: 'Notícias Tech',
    minutesAgo: 2_900
  },
  {
    source: 'news',
    kind: 'article',
    title: 'Novo modelo de IA foca em agentes que usam o computador',
    description: 'Demonstrações mostram autonomia para tarefas longas — e os limites continuam evidentes.',
    author: 'Notícias Tech',
    minutesAgo: 5_000,
    isRead: true
  },
  {
    source: 'news',
    kind: 'article',
    title: 'Framework JavaScript dispara em popularidade',
    description: 'Pesquisa anual mostra mudança de preferência entre desenvolvedores full-stack.',
    author: 'Notícias Tech',
    minutesAgo: 8_900,
    isRead: true
  },

  // Outros
  {
    source: 'other',
    kind: 'article',
    title: 'Como organizar seus feeds sem virar refém deles',
    description: 'Um sistema simples em três camadas: capturar, triar e ler de verdade.',
    author: 'Outros Links',
    minutesAgo: 320
  },
  {
    source: 'other',
    kind: 'article',
    title: 'Newsletter semanal #42',
    description: 'As melhores leituras sobre produtividade, design e engenharia da semana.',
    author: 'Outros Links',
    minutesAgo: 4_200,
    isRead: true
  },
  {
    source: 'other',
    kind: 'other',
    title: 'Documentação: guia definitivo de SQLite em produção',
    description: 'WAL, backups, concorrência e quando o SQLite é a escolha certa.',
    author: 'Outros Links',
    minutesAgo: 11_000,
    isRead: true
  },

  // Podcasts (categoria personalizada)
  {
    source: 'podcast',
    categoryId: 'podcasts',
    kind: 'article',
    title: 'Episódio 57 — Produtividade sem culpa',
    description: 'Uma conversa sobre sistemas pessoais que funcionam e não viram mais uma tarefa.',
    author: 'Demo · Podcasts',
    minutesAgo: 480
  },
  {
    source: 'podcast',
    categoryId: 'podcasts',
    kind: 'article',
    title: 'Episódio 112 — Carreira em tecnologia aos 40',
    description: 'Transição de área, expectativas salariais e o que ninguém conta sobre recomeçar.',
    author: 'Demo · Podcasts',
    minutesAgo: 7_200,
    isRead: true
  }
];

function hoursFromNow(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

interface DemoGame {
  appid: number;
  name: string;
  base: number;
  official: number;
  keyshop: number;
  officialLow: number;
  keyshopLow: number;
  target: number | null;
  discount: number;
}

const DEMO_GAMES: DemoGame[] = [
  {
    appid: 1091500,
    name: 'Cyberpunk 2077',
    base: 19990,
    official: 5990,
    keyshop: 4490,
    officialLow: 5990,
    keyshopLow: 4490,
    target: 5490,
    discount: 70
  },
  {
    appid: 1145350,
    name: 'Hades II',
    base: 8899,
    official: 5790,
    keyshop: 4990,
    officialLow: 5490,
    keyshopLow: 4790,
    target: 7000,
    discount: 35
  },
  {
    appid: 1245620,
    name: 'ELDEN RING',
    base: 27490,
    official: 16490,
    keyshop: 13990,
    officialLow: 14990,
    keyshopLow: 12990,
    target: null,
    discount: 40
  },
  {
    appid: 1086940,
    name: "Baldur's Gate 3",
    base: 19990,
    official: 13990,
    keyshop: 11990,
    officialLow: 13990,
    keyshopLow: 11990,
    target: null,
    discount: 30
  },
  {
    appid: 2358720,
    name: 'Black Myth: Wukong',
    base: 24990,
    official: 17490,
    keyshop: 15990,
    officialLow: 15990,
    keyshopLow: 14990,
    target: null,
    discount: 30
  }
];

/** Jogos fictícios + 30 dias de histórico para a tela de Wishlist. */
function seedDemoGames(): number {
  const today = dateInZone(new Date(), env.timezone);
  const now = nowIso();
  const lastCheck = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const addedAt = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

  const insertGame = db.prepare(
    `INSERT INTO games (
       id, appid, name, cover_url, header_url, currency, target_price_cents,
       steam_base_cents, steam_final_cents, steam_discount,
       current_official_cents, current_keyshop_cents, official_low_cents, keyshop_low_cents,
       is_at_low, in_wishlist, origin, priority, gg_url, is_demo,
       added_at, removed_at, metadata_fetched_at, last_price_check_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'demo', NULL, ?, 1, ?, NULL, ?, ?, ?, ?)`
  );

  const insertHistory = db.prepare(
    `INSERT INTO price_history (game_id, day, official_cents, keyshop_cents, currency)
     VALUES (?, ?, ?, ?, 'BRL')`
  );

  let count = 0;
  for (const game of DEMO_GAMES) {
    // Nunca sobrescreve um jogo real adicionado pelo usuário.
    if (getGameByAppid(game.appid)) continue;

    const id = randomUUID();
    const image = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    const isAtLow = game.official <= game.officialLow + 1;

    insertGame.run(
      id,
      game.appid,
      game.name,
      image,
      image,
      game.target,
      game.base,
      game.official,
      game.discount,
      game.official,
      game.keyshop,
      game.officialLow,
      game.keyshopLow,
      isAtLow ? 1 : 0,
      `https://gg.deals/steam/app/${game.appid}/`,
      addedAt,
      now,
      lastCheck,
      now,
      now
    );

    for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
      const day = addDaysToDate(today, -dayOffset);
      const progress = (29 - dayOffset) / 29;
      const official =
        dayOffset === 0
          ? game.official
          : Math.round(game.official + (game.base - game.official) * (1 - progress) * 0.85);
      insertHistory.run(id, day, official, Math.round(official * 0.85));
    }

    count++;
  }

  return count;
}

/**
 * Cria fontes e itens de demonstração.
 * Não faz nada se já existir alguma fonte (a menos que `force` seja true).
 */
export function seedDemoData(force = false): {
  sources: number;
  items: number;
  games: number;
  skipped: boolean;
} {
  if (!force && countSources() > 0) {
    return { sources: 0, items: 0, games: 0, skipped: true };
  }
  if (!force && countDemoSources() > 0) {
    return { sources: 0, items: 0, games: 0, skipped: true };
  }

  // Recriar do zero: remove os dados demo antigos (sem tocar em fontes reais).
  if (force) {
    deleteDemoSources();
    deleteDemoGames();
  }

  // Categoria personalizada: prova que categorias viram abas novas.
  upsertCustomCategory({ id: 'podcasts', label: 'Podcasts', icon: 'mic', color: '#f97316' });

  const sourceIds = new Map<string, string>();
  const insertSource = db.prepare(
    `INSERT INTO sources (id, type, name, category_id, config, enabled, interval_minutes,
       next_run_at, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 30, ?, 1, ?, ?)`
  );

  const now = nowIso();
  // Demo não roda automaticamente nos primeiros dias: evita erros de rede
  // enquanto o usuário explora a interface. O botão "Atualizar" continua válido.
  const nextRun = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

  for (const source of DEMO_SOURCES) {
    const id = randomUUID();
    sourceIds.set(source.key, id);
    insertSource.run(
      id,
      source.type,
      source.name,
      source.categoryId,
      JSON.stringify(source.config),
      nextRun,
      now,
      now
    );
  }

  const insertItem = db.prepare(
    `INSERT INTO items (
      id, source_id, external_id, dedupe_key, category_id, kind, title, url, thumbnail_url,
      description, author, published_at, discovered_at, is_read, read_at, is_favorite, is_watch_later, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let itemCount = 0;
  DEMO_ITEMS.forEach((item, index) => {
    const sourceId = sourceIds.get(item.source);
    if (!sourceId) return;
    const categoryId = item.categoryId ?? DEMO_SOURCES.find((source) => source.key === item.source)?.categoryId ?? 'other';
    const publishedAt = hoursFromNow(item.minutesAgo);
    const isRead = item.isRead ?? false;

    insertItem.run(
      randomUUID(),
      sourceId,
      `demo-${index}`,
      `demo:${index}`,
      categoryId,
      item.kind,
      item.title,
      `https://example.com/demo/${index + 1}`,
      item.thumbnail ?? null,
      item.description,
      item.author,
      publishedAt,
      publishedAt,
      isRead ? 1 : 0,
      isRead ? publishedAt : null,
      item.isFavorite ? 1 : 0,
      item.isWatchLater ? 1 : 0,
      JSON.stringify({ demo: true })
    );
    itemCount++;
  });

  const gameCount = seedDemoGames();
  return { sources: DEMO_SOURCES.length, items: itemCount, games: gameCount, skipped: false };
}

/**
 * Instalações que já existiam antes da Fase 3 ganham os jogos demo sem
 * duplicar fontes/itens. Só age se houver fontes demo e nenhum jogo demo.
 */
export function ensureDemoGames(): number {
  if (countDemoSources() === 0 || countDemoGames() > 0) return 0;
  return seedDemoGames();
}
