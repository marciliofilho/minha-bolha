# Minha Bolha

> [English](README.md) · Português (Brasil)

> Em English e Español, o app aparece como **My Bubble**. Os nomes técnicos (`@hub/*`, `hub.db`, `HUB_*`) continuam iguais.

Agregador pessoal que reúne, em um único feed, as atualizações de tudo o que você acompanha — canais do YouTube, novels, animes, filmes/séries, notícias, links personalizados e preços de jogos — com calendário de lançamentos e wishlist.

Roda **100% local**, sem login, com banco SQLite e agendador próprio.

> **Status:** Fases 1 a 4 concluídas + biblioteca do Stremio, addons (catálogos, diagnóstico e streams) e player no Feed — feed completo, gerenciador de fontes, YouTube, RSS, TMDB, AniList, novels (Webnovel e outros sites) com progresso de leitura, calendário, wishlist da Steam, preços do gg.deals, alertas, biblioteca/detalhes do Stremio, player e tela Explorar.
> O player do Feed toca streams diretos/HLS e torrents com um **motor embutido** (WebTorrent + FFmpeg), sem precisar abrir o Stremio, com legendas dos addons, troca de faixa de áudio, progresso local/retomada e próximo episódio.
> As fases 4 e 5 estão planejadas e aparecem na interface como "em breve".

---

## Requisitos

- **Node.js 22.5+** (testado com Node 26)
- npm 10+
- Windows, macOS ou Linux

O SQLite usado é o módulo nativo `node:sqlite` — **não há dependência nativa para compilar**.

---

## Instalação

```bash
# 1. dependências (Electron + Chromium já vêm no pacote)
npm install

# 2. configuração (opcional)
cp .env.example .env      # no Windows: copy .env.example .env
# Você também pode colar as chaves direto no app, em Configurações → Chaves de API.
# O .env serve como fallback se você preferir manter tudo em arquivo.
```

## Execução

### Desenvolvimento (front + API com reload)

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://127.0.0.1:4000>
- O Vite faz proxy de `/api` para a API.

### Produção local (um único servidor)

```bash
npm run build
npm start
```

Abre em <http://127.0.0.1:4000> — a API também serve o frontend compilado.

### App desktop (navegador embutido no card)

```bash
npm run desktop
```

- Compila o frontend, abre o Minha Bolha em uma janela **Electron** e inicia a API se ela ainda não estiver rodando.
- O card **Browser** usa um Chromium embutido (`<webview>`) na própria janela, sem abrir outra janela na barra de tarefas.
- A sessão do navegador fica separada (`persist:hub-browser` em `data/desktop`) e não interfere no navegador normal do usuário.
- `npm run desktop:dev` abre sem recompilar (útil depois de `npm run build`).
- **Novels, links personalizados e o navegador vivo** usam um processo auxiliar com o **Chromium do próprio Electron**, em janelas ocultas e sem botão na barra de tarefas. Não é preciso instalar Chrome nem Edge.
- **Primeiro boot:** uma janela pergunta o idioma antes da intro. A escolha é salva no SQLite e já define o vídeo correto (PT-BR ou Global), o nome do app e o idioma da interface. A janela pode ser minimizada; fechá-la encerra a abertura.
- Na abertura, uma **intro em vídeo transparente** toca por ~5 s enquanto a API e a janela principal carregam escondidas. A intro **PT-BR** fica em `apps/desktop/splash/assets/pt-BR/intro.webm` e é usada apenas para Português (Brasil). Os demais idiomas usam `apps/desktop/splash/assets/global/intro.webm`; enquanto esse arquivo não existir, o app abre sem intro nesses idiomas.
- A intro pode ser desligada ou ter o áudio desativado em **Configurações → Interface → Inicialização**. As variáveis `HUB_SPLASH=0` e `HUB_SPLASH_MUTED=1` continuam funcionando como override.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API + Vite em paralelo |
| `npm run dev:api` | Só a API (tsx watch) |
| `npm run dev:web` | Só o frontend |
| `npm run build` | Compila o frontend em `apps/web/dist` |
| `npm run build:api` | Compila a API em um arquivo ESM (`apps/api/dist`) |
| `npm run dist` | Gera o instalador NSIS e o portátil em ZIP |
| `npm run icon` | Regenera o `icon.ico` a partir da arte PT-BR |
| `npm start` | Só a API (serve o build, se existir) |
| `npm run desktop` | Compila e abre o app desktop com navegador embutido |
| `npm run desktop:dev` | Abre o app desktop sem recompilar |
| `npm run seed` | Recria as fontes/itens de demonstração |
| `npm run typecheck` | Checagem de tipos de API e web |
| `npm run check:secrets` | Verifica se chaves/tokens entrariam no Git |

---

## Variáveis de ambiente

Tudo fica na raiz em `.env` (nunca comite esse arquivo). As **chaves de API** podem ser salvas pela interface, em **Configurações → Chaves de API**; o `.env` é apenas o fallback. O valor salvo no app tem prioridade.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4000` | Porta da API |
| `HOST` | `127.0.0.1` | Interface de rede. Use `0.0.0.0` só se quiser acessar de outro dispositivo |
| `HUB_DB_PATH` | `./data/hub.db` | Caminho do SQLite |
| `TZ` | `America/Sao_Paulo` | Fuso padrão (também configurável na UI) |
| `HUB_SEED_DEMO` | `true` | Cria dados fictícios no primeiro boot |
| `TMDB_API_KEY` | — | Fallback para filmes e séries |
| `GGDEALS_API_KEY` | — | Fallback para preços de jogos |
| `APP_SECRET` | — | Chave que criptografa tokens/URLs do Stremio. No app empacotado é gerada automaticamente em `data/app-secret`; o `.env` tem prioridade |
| `HUB_BROWSER_PATH` | — | **Obsoleto.** O app usa o Chromium do próprio Electron; a variável não é mais necessária |
| `STREMIO_SERVER_URL` | `http://127.0.0.1:11470` | Fallback opcional de torrents/HLS. O motor embutido não depende dele |
| `TORRENT_CACHE_DIR` | `./data/torrent-cache` | Onde o WebTorrent guarda os pedaços baixados e os segmentos HLS |
| `FFMPEG_PATH` / `FFPROBE_PATH` | — | Sobrescrevem os binários empacotados (`ffmpeg-static`/`ffprobe-static`) |

**Nenhuma chave é devolvida pela API.** A UI recebe apenas o status, a origem (`app` ou `.env`) e uma máscara com os 4 últimos caracteres.

O `.gitignore` bloqueia o `.env` e qualquer variação (`.env.bak`, `.env.old` etc.), com exceção de `.env.example`. Antes de commitar, rode `npm run check:secrets`: ele analisa os arquivos que entrariam no Git e falha se encontrar chave, token, senha, `.env` ou banco local.

### Como obter cada chave

Você pode colar as chaves em **Configurações → Chaves de API** (recomendado) ou no `.env`.

- **TMDB** — crie uma conta em <https://www.themoviedb.org>, vá em *Configurações → API* e copie a **API Key (v3)** ou o **Read Access Token (v4)**.
- **gg.deals** — solicite acesso em <https://gg.deals/api/>. O plano gratuito é para **uso pessoal** e exige atribuição visível ("Preços por gg.deals") e a não alteração de links de afiliado — o app já foi desenhado para isso.
- **Steam** não exige chave: a wishlist pública e o XML do perfil são lidos diretamente. Se um link `steamcommunity.com/id/nome` não resolver, use o SteamID64 ou o link `/profiles/…`. A chave da Steam foi removida da tela de configuração.

### Chaves pelo app

- **Precedência:** valor salvo no app → valor do `.env`.
- As chaves ficam na tabela `secrets` do SQLite local (`data/hub.db`, ignorado pelo git).
- A API nunca devolve o valor: só `configurada`, origem (`app`/`.env`) e a máscara `••••1234`.
- Salvar a chave do **gg.deals** cria (ou reativa) a fonte “Preços · gg.deals”. Remover a chave do app pausa essa fonte, a menos que exista um valor no `.env`.
- Remover a chave do app volta a usar o `.env`, se houver.
- **`APP_SECRET` não é editável pela UI**: no app empacotado ele é gerado automaticamente em `data/app-secret`; o `.env` tem prioridade. Trocar o valor invalida a sessão salva (basta reconectar).
- Não há criptografia em repouso para as chaves no SQLite; o arquivo fica na sua máquina.

---

## O que já funciona (Fases 1 a 4)

**Feed e leitura**
- **Feed** com scroll infinito e paginação por cursor (keyset), ordenado por data.
- **3 formatos de visualização**: **Estilo Flix** (primeiro), lista e grade (destaque + fileiras por categoria, com setas e arrastar). A preferência fica salva no navegador.
- **Layout responsivo**: em telas largas, as fileiras e a grade usam toda a largura disponível para mostrar mais cards; o destaque mantém o tamanho de leitura.
- **Destaque do Estilo Flix**: alterna a cada 8 s como sugestão, pausa ao passar o mouse e **também aparece nas fileiras** abaixo. Em vídeos do YouTube, o destaque vira um **player nativo** (iframe `youtube-nocookie`); clicar em qualquer card de vídeo abre o player no topo, sem sair da página. O ícone de link externo continua abrindo o YouTube.
- **Abas** Todos / YouTube / Novels / Animação/Anime / Filmes / Séries / Jogos / Notícias / Outros + **categorias personalizadas** (o seed cria "Podcasts" para demonstrar) + **Favoritos** e **Ver depois**, que reúnem os itens marcados em qualquer feed.
- **Capítulos de novel** aparecem com a capa vertical do livro, o capítulo e a **data/hora exata** de publicação; o botão **“Lido até aqui”** grava esse capítulo como o último lido da novel.
- **Contador de não lidos** por aba (incluindo Favoritos/Ver depois) e por fonte, com **filtro por fonte** dentro da aba.
- **Lido / não lido, favorito e ver depois**, com atualização otimista.
- **Abrir no link original** em nova aba (marca como lido).
- **Atualização manual** com estado em tempo real via SSE.
- **Atualizações em lote**: durante uma sincronização, os eventos são agrupados e os contadores/fontes atualizam sem recarregar o feed a cada item. O feed só é atualizado ao final e, quando você já rolou várias páginas, as páginas antigas não são relidas; as abas Favoritos/Ver depois não são recarregadas por itens novos.
- **Adicionar fontes pelo Feed**: o botão **Adicionar fontes**, ao lado de Notificações/Atualizar, abre um popup para escolher entre **Fonte** (YouTube, RSS, novels, filmes, séries, jogos ou links) e **Addon** do Stremio, sem precisar sair do Feed.

**Fontes e conectores**
- **Agendador** com intervalo por fonte, jitter, backoff e concorrência limitada.
- **Gerenciador de fontes** com status, última/próxima verificação, erro e motivo, pausar, editar, remover e histórico de execuções. Acessível pelo menu **Fontes** ou por **Configurações → Fontes e canais**. As fontes usam toda a largura da tela como o Feed e a Biblioteca e podem ser vistas em **lista** ou **grade** (a escolha fica salva em `hub.sources.view`). Há **filtro por gênero** (Todos, YouTube, Filmes, Séries, Animação/Anime, Jogos, Notícias, Novels, Outros e categorias personalizadas), com contagem de fontes por gênero. Animações do TMDB (filmes ou séries) são classificadas automaticamente em **Animação/Anime**, e a importação da biblioteca também cria fontes do AniList para animes com IDs Kitsu/AniList/MAL. O botão **Selecionar** ativa a **seleção múltipla** para marcar várias fontes e removê-las de uma vez, com confirmação única.
- **YouTube** via RSS público (aceita `/@nome`, `/channel/UC…`, `/c/nome`, `/user/nome` e o ID puro). Quando o RSS do YouTube devolve 404/500, o Hub lê a página `/videos` do canal como alternativa, sem API key. O feed do YouTube mostra apenas **vídeos dentro da janela configurada** (48 horas por padrão); os mais antigos continuam no banco, mas ficam ocultos do feed. A mesma janela vale para as **notícias**.
- **RSS/Atom** (RSS 2.0, Atom e RSS 1.0), com descoberta de imagem, autor e resumo.
- **TMDB**: busca por nome ou link do IMDB, com datas de cinema/digital por região para filmes e episódios futuros para séries.
- **AniList**: busca por nome e agenda de episódios com horário exato.
- **Novels**: cole a **página principal** da obra em sites como **Webnovel** (`webnovel.com/pt/book/…`), **Royal Road**, **Wuxiaworld**, **ReadNovelFull**, **Novel Fire** e outros. O Hub extrai capa, autor, sinopse e o **último capítulo com data/hora** (quando o site informa), e salva cada capítulo novo no feed. A aba **Fontes** mostra a capa, o último capítulo e o **progresso de leitura** (“lido até o capítulo X”), que fica salvo no banco e pode ser atualizado no card da fonte ou direto no feed. A Webnovel usa um extrator dedicado; os demais sites usam JSON-LD, dados embutidos e a lista de capítulos da página. Se a lista não aparecer, o progresso pode ser informado manualmente.
- **Links personalizados**: cadastre uma **página comum** (notícia, blog, loja, documentação etc.) pelo tipo **Link**. O Hub mostra uma prévia com título, imagem e descrição, e cria um item no Feed quando o conteúdo relevante da página muda. A checagem usa o mesmo Chromium headless das novels/notícias e respeita o intervalo mínimo de 30 minutos.
- **Modo leitura de novels**: clicar em um capítulo no Feed abre um **leitor dentro do próprio Feed**, sem ir para o navegador externo. O Hub busca somente o capítulo aberto, mostra o texto em uma área de leitura e oferece uma **caixa para escolher qualquer outro capítulo** da obra. O idioma da leitura fica salvo (padrão Português) e o capítulo é **traduzido no backend** antes de aparecer no leitor, sem barra do tradutor, sem recarregar a página e sem esperar o widget do Google. A rolagem usa `requestAnimationFrame`: segurar **↑/↓** rola de forma contínua e fluida. Atalhos: **←** capítulo anterior, **→** próximo capítulo, **↑/↓** rolar a leitura e **Esc** sair; também há o botão **Sair**. O conteúdo é cacheado por 30 min e a tradução por 6 h no backend para reabrir rápido.
- **Modo leitura de notícias**: clicar em uma notícia/artigo no Feed também abre o **leitor interno**, com o texto principal extraído da página, o mesmo seletor de idioma e a mesma rolagem fluida. O botão **Abrir no site** continua disponível no destaque para quem quiser ver a página original.
- **Cards de novel no Feed**: os capítulos são agrupados em um único card por novel. O card mostra o **nome da obra**, a capa, **X/Y capítulos lidos** e um selo **Novo** quando há capítulo novo. Ao manter o mouse pelo tempo configurado em **Configurações → Interface → Feed e prévias**, abre uma prévia com sinopse, **Traduzir sinopse** (para o idioma escolhido no leitor), **Ler último capítulo**, **Continuar lendo** e um seletor com todos os capítulos. A lista completa contorna a paginação dos sites (ex.: Novel Fire `/chapters?page=N`), então o seletor mostra todos os capítulos disponíveis, não apenas os primeiros 100.
- **Cache de novels**: a lista de capítulos e os conteúdos já lidos ficam salvos no SQLite. A prévia aparece mesmo quando o site está bloqueado/lento, usando a última lista salva; o conteúdo do capítulo só é buscado quando você abre o capítulo e também fica em cache. A **Webnovel** é lida pela janela “live” do Chromium embutido (a mesma que passa pela verificação do site); se o desafio aparecer, o app espera ele se resolver, limpa só os cookies de proteção e reabre a URL canônica. Se ainda falhar, tenta automaticamente a **webview do navegador do Feed**, a **extração por HTML** com os cookies da sessão, o **leitor externo Jina**, a **versão móvel** e o **scraping**. Enquanto o capítulo carrega, o leitor mostra **cada tentativa** em andamento. Páginas de verificação e capítulos bloqueados nunca são exibidos como se fossem o capítulo. No leitor, o botão **Comentários** (ao lado de Capítulo) alterna entre o texto limpo e o texto com os contadores de comentários por parágrafo, e o botão **Offline** liga/desliga o salvamento dos capítulos vistos. A prévia tem **Ler primeiro capítulo** e **Baixar capítulos** (modal para escolher capítulos e salvar para leitura sem internet). Capítulos já baixados aparecem como **Baixado** e ficam desabilitados, então só os que faltam podem ser selecionados. O download continua **em segundo plano** mesmo com o modal fechado: o progresso aparece no próprio modal e numa caixa ao lado de **Visualização** no Feed, que fica sempre visível (com botão de olho para esconder). Clicar nessa caixa abre o progresso por capítulo; concluídos saem da lista, falhas podem ser tentadas de novo e há um botão para **cancelar os downloads em andamento**. Ao lado do olho, a **engrenagem** abre o gerenciador de **capítulos offline**: miniaturas das novels com o nome abaixo, lista dos capítulos salvos da novel escolhida, exclusão individual e exclusão em lote (selecionar vários). Os capítulos baixados são **traduzidos antecipadamente para o idioma do App** durante o download, então abrem direto no idioma correto. O capítulo aberto é salvo automaticamente como progresso, então clicar no card retoma de onde você parou. Em **Configurações → Sistema** há a seção separada **Capítulos offline** (ativado por padrão, uso em disco, limpeza manual e retenção automática, padrão 7 dias); o cache de prévias fica em **Cache inteligente** e o tamanho total em **Armazenamento e cache**.

**Calendário**
- Visão **mensal** com marcação por tipo e painel do dia selecionado.
- Lista **"Próximos 30 dias"** agrupada por data.
- Filtro por Filmes / Séries / Animes e navegação entre meses.
- **Calendário global independente da biblioteca**: lançamentos de filmes (TMDB), estreias/episódios de séries em exibição e a agenda global de animes (AniList).
- **Busca de título** no calendário: destaca os dias com resultados, leva ao primeiro resultado e realça os itens na lista do dia. Funciona no escopo Global e no da biblioteca, sem acentos/case.
- Alternância **Global** / **Minha biblioteca** (preferência salva no navegador). **Global** mostra o catálogo inteiro; **Minha biblioteca** mostra só os títulos que você acompanha.
- A fonte automática **Calendário global** sincroniza a cada 6h; o botão **Atualizar** força uma nova sincronização.
- No escopo **Minha biblioteca**, os eventos mantêm a fonte e o selo do Stremio; no **Global**, os dados vêm do TMDB/AniList.
- Janela de ~45 dias atrás e ~75 dias à frente para filmes/séries. A agenda de animes cobre ~30 dias à frente (limite prático da API do AniList) e uma semana de histórico; séries em exibição cobrem os próximos 7 dias.
- Datas e horários no **fuso configurado**; lançamentos locais do dia viram itens no feed.

**Jogos e preços**
- **Wishlist da Steam** por SteamID64, link do perfil ou vanity, com sincronização a cada 6h e detecção de entradas/saídas.
- **Perfil da Steam** editável/removível na própria aba Wishlist, sem depender de chave de API. Remover o perfil interrompe a sincronização, mas mantém os jogos e os preços.
- **gg.deals** com preço atual e mínima histórica separados em **lojas oficiais** e **keyshops**.
- Grade com capa, desconto, preço, mínima, sparkline de 30 dias e selo "na mínima".
- Filtros (wishlist / fora / promoção / mínima), ordenação e **"apenas lojas oficiais"**.
- Detalhe com gráfico de histórico, links, preço-alvo e verificação avulsa.
- **Jogos no Feed**: um único card por jogo (alertas antigos não duplicam), mostrando o menor preço atual entre lojas oficiais e keyshops; clicar no card abre o mesmo modal de detalhes da Wishlist.
- **Alertas no feed** para alvo atingido, nova mínima histórica e desconto relevante.
- Adição manual por nome, appid ou link da Steam.
- Atribuição **"Preços por gg.deals"** em todas as telas com esses dados.

**Stremio**
- **Biblioteca** no próprio app: todos os títulos, filtros por filme/série e busca.
- **Tela de detalhes** com capa, sinopse, gêneros, temporadas e progresso (dados da biblioteca + TMDB).
- Conexão da conta por e-mail/senha (senha usada **uma única vez**) ou chave de acesso manual.
- Token criptografado no SQLite (AES-256-GCM com `APP_SECRET`); nunca volta para o frontend nem aparece em logs.
- **Continuar assistindo / Seus Streamings** no topo do feed, apenas na aba **Todos**. A página **Biblioteca** mostra a grade completa, sem a faixa de continuar assistindo. No Feed, clicar em um card abre a **lista de streams no card de destaque**. A seção local (**Reproduzido no Hub**) tem um olho para minimizar; a seção do Stremio agora se chama **Seus Streamings**, também tem olho, permite borrar a conta conectada ao clicar no login e inclui uma busca que consulta a **biblioteca e os addons** (com debounce).
- **Abas de Seus Streamings**: filtros **Todos**, **Filmes**, **Séries**, **Animes**, **Favoritos** e **Assistir depois**. A aba **Todos** mostra itens em andamento + títulos salvos na **Minha biblioteca**. Favoritos, Assistir depois e Minha biblioteca são marcações locais do Hub (tabela `stremio_library_state`) e nunca são gravados na conta do Stremio. Animes são reconhecidos por IDs Kitsu/AniList/MAL e por metadados (animação com origem japonesa no TMDB/Cinemeta); assim Gate, Vinland Saga e outros deixam de cair em Séries. O filtro escolhido fica salvo no navegador.
- **Minha biblioteca local**: o botão **+ Minha biblioteca** aparece tanto nos **cards** (Feed, Explorar e catálogos) quanto nas **prévias** de filmes/séries/animes e salva o título só no Hub. Ele aparece em Todos/Filmes/Séries/Animação-Anime e na página Biblioteca com o selo **Hub**, sem escrever na conta do Stremio. Para títulos já salvos apenas no Hub, o mesmo botão remove da Minha biblioteca.
- **Clique nos cards de Explorar/Biblioteca**: abre a **lista de streams no destaque do Feed** (o mesmo fluxo de um card do Feed), em vez de ir direto para a tela de detalhes. Na prévia, o botão **Detalhes** continua disponível para abrir a página completa do título.
- **Navegador no Feed**: o botão **Browser** fica **à esquerda** do card em destaque (fora dele). Ao abrir, o navegador aparece à esquerda e o destaque à direita; ambos tentam manter o **tamanho padrão do destaque** e só encolhem juntos quando a largura da tela não comporta a soma dos dois. Tem barra de endereço (aceita URL, domínio ou busca), voltar/avançar, recarregar, abrir em nova aba e fechar. **No app desktop**, o card usa um `<webview>` do Electron: é um Chromium real embutido na própria janela do Hub, com renderização nativa, JavaScript, login, áudio/vídeo e sem janela extra na barra de tarefas. O webview usa a partição `persist:hub-browser` e o perfil em `data/desktop`, separados do navegador normal do usuário. Ele também **restaura as abas abertas entre sessões**, permite criar/fechar abas e tem **tradução da página no próprio site** (Original, Português, English, Español, Français, Deutsch, Italiano, Japonês, Coreano e Chinês) via Google Translate, sem trocar a URL. **No navegador comum**, sites que permitem incorporação abrem em iframe direto e os protegidos caem no proxy simplificado (o modo de captura por screenshots não é mais usado automaticamente). Para abrir o app desktop use `npm run desktop`.
- **Atualizações e cache inteligente**: no app desktop, o scheduler usa o intervalo global em **segundos** para YouTube, RSS, novels e fontes personalizadas (60–3600s); TMDB/AniList e outras fontes mantêm seus intervalos próprios. O cache de streams tem TTL configurável (1–168h), o cache de torrents é limpo automaticamente após N dias sem uso (0 desativa) e a manutenção remove temporários antigos a cada 6h sem interromper streams. Assets com hash usam cache HTTP imutável; o HTML continua sem cache.
- **Cards com nota e prévia**: os cards de Continuar assistindo/Seus Streamings, **Explorar** e **Biblioteca** mostram a nota IMDb quando disponível. Ao manter o mouse pelo tempo configurado (3 s por padrão), abre ao lado uma prévia com capa, sinopse e trailer do YouTube (mudo), sem sair da página. Cards e prévias de filmes/séries/animes têm o botão **Minha biblioteca**; os cards do Feed também mantêm **Favoritos**. Metadados usam addons → Cinemeta/Kitsu; o trailer é completado pelo TMDB (pt-BR + inglês) e, para animes, pelo AniList. Os cards de catálogo/busca carregam a imagem imediatamente e usam fallback de pôster (Metahub/Kitsu) e placeholder quando a imagem falha.
- **Remover de Continuar assistindo**: a lixeira no card apaga somente o progresso local daquele vídeo (`DELETE /api/playback/progress`); a biblioteca e a conta do Stremio não são alteradas.
- **Notificações de atualizações**: quando um conector encontra conteúdo novo, aparece um card no **topo central** com capa, título, fonte e contexto: vídeo do YouTube, série/anime com temporada/episódio, filme ou novel com o capítulo. Um som leve de duas notas toca ao chegar (o navegador libera o áudio no primeiro clique). O card fecha sozinho em 8 s e tem **X** para fechar. **Clicar no card abre o conteúdo direto no player do Feed**: vídeo do YouTube no destaque e filme/série na lista de streams. Não há mais botão separado de "Abrir conteúdo". Alimentado pelo evento SSE `items:new`, que envia o item com `id`, `imdbId` e `mediaKind` para permitir a abertura. O Feed tem o botão **Testar notificação** (ícone de sino) que simula três avisos - vídeo de canal, série e filme - usando itens reais do feed e, quando não há filme/série no feed, um título da sua biblioteca.
- **Filtro de notificações**: o sino ao lado de **Atualizar** abre uma lista para marcar/desmarcar categorias (YouTube, Novels, Séries, Filmes, Notícias etc.). As preferências ficam salvas no navegador e valem para as notificações reais; o botão **Testar notificação** ignora o filtro para sempre mostrar os três exemplos.
- **Carregar mais na Biblioteca**: a grade mostra 25, 50 ou 100 títulos por vez, escolhidos em **Mostrar** (a preferência fica salva em `hub.library.limit`); o botão **Carregar mais** revela mais um lote do tamanho escolhido. Busca e filtros reiniciam para o primeiro lote.
- **Olho e ordem das seções do Feed**: cada fileira (Notícias, YouTube, Séries, Novels, etc.) e também Continuar assistindo/Seus Streamings têm olho para minimizar e setas para subir/descer. A ordem e as seções recolhidas ficam salvas no navegador (`hub.feed.sectionOrder` e `hub.feed.collapsedRows`).
- **Layout responsivo**: Feed, Biblioteca, Explorar, Calendário e Wishlist usam toda a largura disponível, com grades que criam/removem colunas conforme o espaço (`auto-fill` + `minmax`). Configurações, Fontes e Detalhes mantêm uma largura de leitura confortável.
- **Player no destaque do Feed**: filmes, séries e animes abrem a lista de streams dos addons no próprio hero; a opção escolhida toca ali mesmo. Streams diretos/HLS usam o player nativo; torrents usam o **motor embutido** (WebTorrent baixa os pedaços e o FFmpeg gera HLS sob demanda), sem precisar abrir o Stremio. O Stremio Server é apenas um fallback opcional se o motor embutido falhar. A tela de detalhes também tem o botão **Assistir**.
- **Temporada/episódio** ajustáveis no seletor de streams para séries.
- **Biblioteca como fontes** (importação sem duplicar): filmes e séries viram fontes TMDB (animações vão para Animação/Anime) e animes com IDs Kitsu/AniList/MAL viram fontes AniList, gerando episódios no feed/calendário.
- Indicador **"Na biblioteca"** e sincronização a cada 1h, além do botão manual — somente leitura.
- **Sem deep links**: nada de `stremio://` ou `web.stremio.com`; a navegação é toda dentro do Hub.
- **Addons manuais**: cadastre a URL do `manifest.json` de qualquer addon (aceita `stremio://`). O **Kitsu** é instalado como addon inicial e pode ser desativado ou removido normalmente.
- **Explorar**: catálogos dos addons ativos por addon e tipo (filmes, séries e animes), com seletor de **25/50/100 cards**, botão **Carregar mais** ao final da grade e **busca global** em todos os addons + Cinemeta/Kitsu. O valor escolhido em **Mostrar** é carregado automaticamente; **Carregar mais** serve para ir além dele e busca **uma página por clique**, sem cascata. O Hub contorna buracos de paginação de alguns addons (ex.: página vazia no meio) e descarta itens de erro/placeholder (ex.: “Error Loading Content”/“No Content”). A busca consulta as fontes em paralelo, aplica timeout curto e filtra por similaridade de título.
- **Diagnóstico por addon**: valida o manifest, lista recursos/tipos/idPrefixes, consulta catálogos e uma amostra de streams (tipo, qualidade, tamanho, seeds e tempo).
- **Addons da conta**: importação opcional e somente leitura da coleção instalada no Stremio.
- **Addons seguros**: URL do manifest criptografada com `APP_SECRET`; a API só devolve a versão mascarada.

**Sistema**
- **Configurações por categoria**: **Interface** (aparência, idioma, **Feed e prévias** — janela de YouTube/notícias e atraso da prévia —, inicialização/intro, player/legendas), **Streaming** (fontes, Stremio e addons), **Sistema** (atualizações, região/moeda, cache inteligente, armazenamento/cache e backup) e **Chaves**. As seções longas (Stremio, Addons e Chaves) podem ser minimizadas com o olho ao lado do título, e a categoria/seções ficam lembradas no navegador.
- **Armazenamento e cache**: mostra o espaço usado pelo cache de streams/torrents/HLS, temporários do navegador e banco SQLite; permite **limpar caches** (com confirmação, interrompendo streams em andamento) e **otimizar o banco** com `VACUUM`/`PRAGMA optimize`. A seção **Cache inteligente** ajusta o TTL do cache de streams, a retenção do cache de torrents e a manutenção automática.
- **Backup e portabilidade**: exporta um JSON com **fontes reais, categorias personalizadas e configurações** (incluindo o progresso de leitura salvo no config das novels). Chaves de API, caches, torrents, arquivos temporários e dados da conta do Stremio **não entram** no arquivo. A importação mostra uma **prévia** com quantas fontes/categorias são novas ou já existem e, após confirmação, **mescla** os dados: fontes com o mesmo ID são atualizadas e as demais são criadas.

---

## Arquitetura

```
apps/web        React + Vite + TypeScript + Tailwind v4 + TanStack Query
apps/api        Express 5 + SQLite (node:sqlite) + scheduler próprio + conectores
packages/shared tipos, constantes e schemas Zod usados pelos dois lados
```

```
Scheduler (tick 30s)
  └─ fila (2 jobs simultâneos)
       └─ Connector.fetch(ctx) → { items, media?, releaseEvents? }
            ├─ itens de feed      → INSERT ... ON CONFLICT(dedupe_key) DO NOTHING
            └─ mídia e calendário → upsert media + release_events
                 └─ eventos de hoje/últimos 7 dias → itens de feed
                      └─ SSE: items:new / source:status / refresh:state
```

**Carregamento do frontend:** as páginas (`Biblioteca`, `Explorar`, `Detalhes`, `Calendário`, `Wishlist`, `Fontes`, `Config`, `404`) e o seletor de streams são carregados sob demanda (`React.lazy` + `Suspense`). O Feed é o único chunk inicial; o HLS e o `StreamPicker` só baixam quando você abre um player ou a lista de streams. Isso reduziu o bundle inicial de ~712 kB para ~513 kB (gzip ~150 kB). O cache de streams do backend é persistente (SQLite), então reabrir um título já consultado devolve a lista em ~0,2 s.

### Conectores

Cada tipo implementa a interface em `apps/api/src/connectors/types.ts`:

```ts
interface Connector {
  type: SourceType;
  defaultIntervalMinutes: number;
  minIntervalMinutes: number;
  resolve?(input, settings): Promise<ResolvedSourceDto>;       // URL/nome → config
  search?(query, settings): Promise<MediaSearchResultDto[]>;   // TMDB/AniList
  fetch(ctx): Promise<{
    items: RawItem[];
    state: unknown;
    media?: RawMedia;              // título acompanhado
    releaseEvents?: RawReleaseEvent[]; // calendário
  }>;
}
```

Para adicionar um tipo novo:

1. Crie `apps/api/src/connectors/meu-tipo.ts` implementando `Connector`.
2. Registre em `connectors/registry.ts`.
3. Marque `available: true` em `SOURCE_TYPES` (`packages/shared/src/index.ts`).
4. Opcional: adicione campos específicos no formulário do frontend.

Erros são padronizados (`blocked`, `rate_limited`, `private`, `layout_changed`, `auth`, `not_found`, `network`, `config`). O scheduler usa o código para aumentar o backoff e a UI traduz para uma mensagem curta.

### Agendador

- Tick a cada **30 s**; fontes vencidas entram numa fila.
- Concorrência: **2** jobs (na Fase 1; será 1 para Playwright).
- `next_run = intervalo × jitter(0.9–1.1) + 0–2 min`.
- Falha: backoff exponencial (até 24 h); bloqueio/privado/layout mudado: mínimo 6 h.
- No boot, fontes atrasadas são espalhadas por até 2 minutos para evitar rajada.
- Ao criar uma fonte, ela é atualizada imediatamente.

### Intervalos e pisos

| Conector | Padrão | Piso |
|---|---|---|
| YouTube | 30 min | 15 min |
| RSS | 30 min | 15 min |
| TMDB | 6 h | 1 h |
| AniList | 3 h | 1 h |
| Steam wishlist | 6 h | 2 h |
| gg.deals | 6 h | 6 h |
| Novel (Webnovel/outros sites) | 60 min | 30 min |

### Banco de dados

Migrations em `apps/api/src/db/migrations/`:

- `categories` — abas, incluindo categorias personalizadas.
- `sources` — configuração JSON do conector, estado/cursor, status e agendamento.
- `source_runs` — histórico de verificações (diagnóstico).
- `items` — feed, com `dedupe_key` **único** e índices para paginação.
- `settings` — preferências em chave/valor JSON.
- `media` — filme/série/anime acompanhado (1:1 com a fonte, metadados e capa).
- `release_events` — estreias e episódios, com chave estável, data local e horário opcional.
- `global_releases` — lançamentos globais de filmes/séries/animes, independentes das fontes acompanhadas (escopo **Global** do calendário).
- `games` — biblioteca de jogos, preço-alvo, preços atuais e mínimas por mercado.
- `price_history` — menor preço oficial/keyshop por dia (sparkline e gráfico).
- `stremio_account` — e-mail e token criptografado (AES-256-GCM), status e última sincronização.
- `stremio_library` — biblioteca/progresso espelhados (somente leitura), com `meta_id` como chave. A migração 006 mantém a versão antiga como `stremio_library_legacy` para rollback.
- `stremio_addons` — addons cadastrados (URL do manifest criptografada) e resultado do último diagnóstico.
- `stremio_playback` — progresso local do player (Etapa 3).
- `stremio_library_state` — favoritos, Assistir depois e Minha biblioteca local (títulos que existem só no Hub), sem alterar a conta do Stremio.
- `stream_cache` — cache persistente dos streams por addon/título (15 min fresco, 24 h stale, ~600 linhas).
- `media.imdb_id` — usado no indicador “na biblioteca”.

Datas em **UTC ISO 8601**; o calendário agrupa por **data local** no fuso configurado. Dinheiro em **centavos**.

> A API gratuita do gg.deals devolve o **menor preço por mercado** (oficiais e keyshops), não ofertas por loja. Por isso não existe uma tabela de preços por loja: guardamos os dois mercados, os dois mínimos históricos e o link da página do jogo no gg.deals.

### Calendário e geração de itens

1. As fontes TMDB/AniList acompanhadas devolvem `media` + `releaseEvents` e alimentam o calendário local.
2. A fonte automática **`global-releases`** consulta:
   - TMDB: filmes em lançamento, séries em exibição (próximo episódio) e estreias de séries;
   - AniList: `airingSchedules` de todos os animes, sem depender da biblioteca.
3. O calendário escolhe o escopo: **Global** lê `global_releases`; **Minha biblioteca** lê `release_events`. O padrão é Global e a escolha fica no `localStorage`.
4. Eventos **futuros que sumiram** de uma fonte local são removidos; no global, cada provedor substitui apenas a própria fatia quando responde com sucesso.
5. Eventos locais de **hoje e dos últimos 7 dias** viram itens no feed (`dedupe_key = release:{chave}`). O calendário global não gera itens no feed.
6. Episódios com horário exato (AniList) só viram item no feed depois de irem ao ar.

### Jogos, preços e alertas

- **Duas fontes isoladas**: `steam-wishlist` importa a lista e `ggdeals` consulta preços. Falha em uma não afeta a outra.
- A fonte de preços é criada automaticamente (e só existe) quando há uma chave do gg.deals — salva no app ou no `.env`.
- A wishlist precisa ser **pública**. Se vier vazia, a fonte fica com erro `private` e a tela mostra o passo a passo para liberar.
- Metadados (nome, capa, preço base) vêm de `appdetails`, com cache de **7 dias**. A API passou a aceitar **uma consulta por appid** (lotes retornam HTTP 400); o conector busca individualmente com um pequeno intervalo.
- A **chave da Steam não é necessária** e foi removida da tela de configuração: a wishlist pública e o XML do perfil são lidos sem chave. Se um vanity não resolver, use o SteamID64.
- Preços: lotes de até 100 IDs, teto de 400 jogos por execução e pausa entre lotes para respeitar 100/min e 1000/h.
- A primeira verificação de cada jogo **não gera alerta** — evita despejar a biblioteca no feed.
- Alertas (um por jogo por verificação, nesta prioridade):
  1. **Preço-alvo** atingido;
  2. **Nova mínima histórica** (preço oficial);
  3. **Desconto relevante** (≥ 50% e preço abaixo do anterior).
- O alerta de preço usa sempre o **menor preço oficial**; keyshops aparecem na tela, mas não disparam alerta.
- O histórico diário começa na primeira verificação; a mínima histórica vem do gg.deals (desde 2014).

### Stremio

- **Sem deep links** — o Hub não abre `stremio://` nem `web.stremio.com`. Todo o fluxo (biblioteca → detalhes → player) acontece dentro do app.
- **Conta:** a senha é enviada uma única vez ao endpoint de login do Stremio e nunca é gravada. Só o `authKey` é persistido, criptografado com `APP_SECRET`.
- **Contas Facebook/Apple:** use a chave manual. Abra `web.stremio.com`, faça login, F12 → Console e rode `JSON.parse(localStorage.getItem("profile")).auth.key`.
- **Sessão expirada:** o token recusado marca a conta como expirada, pausa a fonte da biblioteca e pede nova conexão — o resto do app continua funcionando.
- **Biblioteca (somente leitura):** `stremio-library` lê `libraryItem` a cada 1h. Nunca adiciona, remove ou grava progresso. A chave local é o ID do Stremio (`meta_id`), então itens com `kitsu:` e outros formatos também são preservados.
- **Biblioteca no app:** a página **Biblioteca** lista todos os títulos ativos, com filtros, busca e **Seus Streamings**. Clicar abre a tela de detalhes do Hub.
- **Detalhes:** capa, sinopse, gêneros, duração, temporadas e progresso. Usa o meta do addon em prioridade e, como alternativa, a biblioteca e o TMDB. O botão **Assistir** abre a lista de streams no próprio app.
- **Importar títulos:** cria fontes TMDB para filmes/séries da biblioteca, sem duplicar as que já existem (checagem por IMDB e por mídia já vinculada). Os títulos importados geram episódios no feed/calendário.
- **Na biblioteca:** o feed e o calendário marcam os títulos cujo IMDB está na biblioteca sincronizada.

> A API de conta do Stremio **não é oficial** e pode mudar sem aviso. O conector foi isolado para que uma falha dele não afete o restante do app.

### Addons do Stremio

- **Nada é instalado**: o addon é um serviço web remoto. O Hub só cadastra a URL do `manifest.json` e consulta o protocolo HTTP oficial.
- **URL segura**: a URL completa pode conter configuração/chave. Ela é criptografada com AES-256-GCM (`APP_SECRET`), nunca volta para o frontend e aparece mascarada como `host/••••/manifest.json`.
- **Conversão**: `stremio://addon/manifest.json` vira `https://addon/manifest.json`.
- **Recursos suportados**: `catalog`, `meta`, `stream` e `subtitles`. O Hub respeita `resources`, `types` e `idPrefixes` de cada addon; só consulta quem declara aquele tipo/ID.
- **Prioridade**: a ordem da lista define quem é consultado primeiro (metadados e streams). Use as setas para reordenar.
- **Importar da conta**: opcional, via `addonCollectionGet` (somente leitura). Duplicatas são ignoradas; a conta nunca é alterada.
- **Diagnóstico**: o botão **Testar** recarrega o manifest, consulta até 3 catálogos e uma amostra de streams, mostrando tempo, tipos (direto/torrent/externo), qualidades, tamanho e seeds. A amostra vem do primeiro catálogo ou, na falta dele, da biblioteca.
- **Explorar**: lista os catálogos ativos por addon e tipo (Todos/Filmes/Séries/Animes). O seletor **25/50/100 cards** carrega automaticamente essa quantidade (contornando páginas vazias/buracos de `skip` de alguns addons) e o contador mostra “X de Y cards”. Depois disso, **Carregar mais** revela os itens já baixados ou busca **uma página por clique**, sem carregar várias de uma vez. Quando acaba, mostra “fim do catálogo”. Itens de erro/placeholder dos addons (ex.: `tmdb:no-content`, “Error Loading Content”) são descartados. A **busca global** consulta os catálogos pesquisáveis de todos os addons e também Cinemeta (filmes/séries) e Kitsu (animes), em paralelo e com cache; depois filtra por similaridade de título. O **Kitsu** aparece como addon instalado no primeiro boot; se você o remover, os catálogos de anime deixam de aparecer no Explorar.
- **Catálogo com busca obrigatória**: a consulta só é feita depois que você digita um termo.
- **Tolerância a falhas**: timeout por addon, erros isolados e mensagens claras (401/403/404/429/rede). Um addon quebrado não afeta os outros.
- **Player no Feed**: a lista de streams é agregada pelos addons e tocada no **card de destaque** (e na tela de detalhes). Streams diretos/HLS usam o player do navegador; torrents usam o **motor embutido** (WebTorrent + FFmpeg), sem exigir o Stremio aberto.
- **Torrents**: o Hub baixa os pedaços via WebTorrent e serve o arquivo com Range. MP4/MOV/WebM com H.264/AAC e uma faixa toca direto; MKV, HEVC, AV1 e 2+ faixas de áudio passam por HLS gerado sob demanda (segmentos de 4 s, com cache em `data/torrent-cache`). O primeiro segmento pode levar alguns segundos e o FFmpeg usa CPU durante a transcodificação.
- **Legendas**: o player consulta os addons de legenda habilitados (OpenSubtitles v3), agrega as opções por idioma e converte SRT/ASS para WebVTT num proxy same-origin. O menu **Legendas** permite escolher a faixa ou desligar; português é selecionado automaticamente quando disponível.
- **Faixas de áudio**: o ffprobe do motor embutido lista as faixas reais. Com 2+, o player mostra o menu **Áudio** com idioma/faixa/codec e recarrega o HLS no áudio escolhido, retomando o tempo atual. O mesmo menu continua funcionando para HLS do Stremio Server quando usado como fallback.
- **Controles e atalhos**: o player usa controles próprios (play/pause, ±N s, volume, progresso e tela cheia) e esconde a barra após 3 s de inatividade enquanto o vídeo toca. Atalhos globais, sem precisar focar o vídeo: **F** tela cheia, **←/→** voltar/avançar N s, **↑/↓** volume, **M** mudo, **K/Espaço** play/pause e **Esc** fecha o menu.
- **Idioma do app**: em **Configurações → Interface → Idioma do app** dá para escolher **Português, English ou Español**. A mudança é aplicada na hora, fica salva no banco local e também ajusta o formato de datas, horas e moeda. O menu, as telas, os modais, os painéis, os leitores, o seletor de streams/player e o navegador embutido já usam o idioma escolhido. As **mensagens técnicas mais comuns da API** também são traduzidas; diagnósticos livres de conectores/sites e nomes dinâmicos de addons podem permanecer no idioma de origem. O idioma do leitor de novels/notícias continua sendo escolhido separadamente dentro do próprio leitor.
- **Preferências em Configurações → Player e legendas**: escolha os segundos de avanço/retrocesso (padrão 10, de 1 a 120), o idioma padrão da legenda (ou desligue a seleção automática), tamanho da fonte, cor do texto, cor e opacidade do fundo (0% remove o fundo), espaçamento entre linhas e a posição vertical da legenda. As mudanças valem no próximo carregamento do player.
- **Progresso local e retomada**: a posição é salva a cada ~5 s, ao pausar, buscar e fechar o player. Ao reabrir o mesmo filme/episódio, o player retoma do ponto salvo e mostra “Retomando de …”. Os itens em andamento aparecem em **Continuar assistindo → Reproduzido no Hub** (com olho para minimizar); ao chegar a ~95% ou terminar, saem da lista. Esse progresso fica só no Hub e nunca é gravado na conta do Stremio.
- **Próximo episódio**: ao terminar um episódio, o player mostra o próximo episódio real da lista. O botão abre o seletor já na temporada/episódio seguinte; você escolhe o stream e continua. Não há escolha automática de stream para evitar usar uma fonte ruim sem confirmação.
- **Fallback de codec**: se o arquivo direto não abrir, o player muda para o HLS de transcodificação. Se o motor embutido não conseguir preparar o torrent (sem peers ou metadados), o Stremio Server é tentado como fallback opcional.
- **Temporada/episódio em cascata**: o seletor consulta o meta dos addons e mostra apenas as temporadas e os episódios existentes; escolher a temporada atualiza a lista de episódios.
- **Torrentio**: as requisições usam um User-Agent de navegador para reduzir bloqueios HTTP 429.
- **Cache persistente de streams**: o resultado de cada addon por tipo/vídeo é gravado em SQLite (`stream_cache`). Uma entrada é considerada fresca por **15 min** e continua servível por até **24 h**; passado esse tempo, a lista antiga é devolvida na hora e atualizada em segundo plano (*stale-while-revalidate*). O cache sobrevive a reinícios da API e é limitado às ~600 consultas mais recentes. Erros ficam em memória por **20 s** para evitar repetir um addon que acabou de falhar. A resposta inclui `cache.used` e `cache.refreshing`, exibidos no seletor como “cache local” e “atualizando em segundo plano…”.
- **Atualizar no seletor**: o botão **Atualizar** ignora o cache (`refresh=1`) e consulta os addons novamente; útil quando um título novo ainda não aparece ou quando uma fonte estava fora do ar.
- **FrostStream**: a URL pública não libera streams sem conta. O seletor mostra **Configurar** (login Google); depois de obter o manifest pessoal, cole-o em **Configurações → Addons**.

> O protocolo de addons é público e estável, mas cada addon pode exigir configuração própria, limitar regiões ou bloquear o acesso. O diagnóstico mostra o motivo quando isso acontece.

### Deduplicação

Cada conector gera uma `dedupe_key` estável:

- YouTube: `yt:{videoId}`
- RSS: `rss:{sourceId}:{hash(guid|link)}`
- Lançamentos/episódios: `release:{chave do evento}`
- Preços: `price:{gameId}:{target|low|discount}:{preçoEmCentavos}` — um alerta por nível de preço

### API

```
GET    /api/feed?tab=&sourceId=&cursor=&limit=
GET    /api/feed/counts
POST   /api/feed/mark-all-read
PATCH  /api/items/:id              { isRead?, isFavorite?, isWatchLater? }

GET    /api/sources
POST   /api/sources                { type, input, name?, categoryId, intervalMinutes? }
PATCH  /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/resolve        { type, input }   → prévia/teste
POST   /api/sources/:id/refresh
GET    /api/sources/:id/runs
GET    /api/sources/:id/novel         → capa, capítulos e progresso (novel)
GET    /api/novels/chapter?url=       → texto do capítulo (cache 30 min)
GET    /api/articles/content?url=     → texto principal da notícia (cache 30 min)
POST   /api/translate                 { text, target } → tradução com cache de 6 h
GET    /api/backup/export             → JSON com fontes, categorias e configurações
POST   /api/backup/preview            → resumo do que será criado/atualizado
POST   /api/backup/import             → mescla o backup (sem chaves/caches)
PUT    /api/sources/:id/novel-progress { chapterId, chapterIndex?, chapterName }
DELETE /api/sources/:id/novel-progress

GET    /api/categories · POST /api/categories
GET    /api/media/search?provider=tmdb|anilist&q=
GET    /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&types=movie,series,anime&scope=global|library
GET    /api/calendar/search?q=&scope=global|library
POST   /api/calendar/refresh          # força a sincronização global

GET    /api/games?filter=&sort=&q=
GET    /api/games/search?q=          # nome, appid ou link da Steam
GET    /api/games/:id
POST   /api/games                    { appid, targetPriceCents? }
PATCH  /api/games/:id                { targetPriceCents }
DELETE /api/games/:id
POST   /api/games/import             { input }   # SteamID64/link/vanity
POST   /api/games/:id/refresh-price  # 1 registro no gg.deals

GET    /api/stremio/status
POST   /api/stremio/login            { email, password }  # senha usada uma vez
POST   /api/stremio/auth-key         { authKey, email? }
POST   /api/stremio/disconnect
POST   /api/stremio/sync
GET    /api/stremio/library?search=   # biblioteca completa (busca opcional)
PATCH  /api/stremio/library/:metaId/state { isFavorite?, isWatchLater?, inLibrary?, type?, name?, poster? }  # marcações locais
POST   /api/stremio/card-info { items: [{ type, id, name? }] }  # nota IMDb, sinopse e trailer (cache 6h)
GET    /api/stremio/title/:type/:id  # detalhes (addon + biblioteca + TMDB)
GET    /api/stremio/title/:type/:id/episodes  # temporadas e episódios reais
GET    /api/stremio/streams?type=&id=&season=&episode=&videoId=&refresh=1  # agrega addons (refresh ignora o cache)
GET    /api/stremio/subtitles?type=&id=&season=&episode=&videoId=  # agrega legendas
GET    /api/stremio/subtitle?url=     # proxy same-origin (SRT/ASS → WebVTT)
GET    /api/stremio/probe?url=        # ffprobe de áudio via Stremio Server (fallback)
GET    /api/stremio/hls?url=          # proxy same-origin de HLS do Stremio Server (fallback)
POST   /api/stremio/torrent/prepare   # inicia o motor embutido e devolve URLs/HLS
GET    /api/stremio/torrent/:id/raw   # arquivo do torrent com Range
GET    /api/stremio/torrent/:id/hls/:audio/index.m3u8  # playlist VOD por áudio
GET    /api/stremio/torrent/:id/hls/:audio/segmentN.ts # segmento gerado sob demanda
GET    /api/stremio/server            # status do Stremio Streaming Server local
POST   /api/stremio/import           # biblioteca → fontes TMDB

GET    /api/playback/progress?metaId=&videoId=  # progresso local de um vídeo
GET    /api/playback/continue                   # itens em andamento
PUT    /api/playback/progress                   # salva posição/estado
POST   /api/playback/progress                   # mesma coisa, para sendBeacon
DELETE /api/playback/progress?metaId=&videoId=  # limpa o progresso

GET    /api/stremio/addons
POST   /api/stremio/addons           { url }
PATCH  /api/stremio/addons/:id       { url?, name?, enabled?, priority? }
DELETE /api/stremio/addons/:id
POST   /api/stremio/addons/reorder   { ids }
POST   /api/stremio/addons/import    # conta → addons (somente leitura)
POST   /api/stremio/addons/:id/test  # diagnóstico
GET    /api/stremio/catalogs
GET    /api/stremio/catalog?addonId=&type=&catalogId=&search=&skip=
GET    /api/stremio/search?query=&type=   # busca global (addons + Cinemeta/Kitsu)

GET    /api/settings  · PATCH /api/settings
GET    /api/health · GET /api/status
GET    /api/system/storage          # tamanho de caches, temporários e banco
POST   /api/system/storage/clear    # limpa cache de streams/HLS e temporários antigos
POST   /api/system/database/optimize # VACUUM + PRAGMA optimize
POST   /api/refresh
GET    /api/events                 (SSE)
POST   /api/demo/seed · DELETE /api/demo
```

---

## Estrutura de pastas

```
.
├─ apps/
│  ├─ api/src/
│  │  ├─ config/env.ts
│  │  ├─ db/            (schema, migrations, repositórios de mídia/calendário/jogos/stremio/addons)
│  │  ├─ connectors/    (youtube, rss, tmdb, anilist, steam-wishlist, ggdeals, stremio, stremio-addons, global-releases, http, registry)
│  │  ├─ domain/        (releases, games, stremio, stremio-addons e títulos)
│  │  ├─ http/          (rotas, erros, server)
│  │  ├─ lib/           (logger, datas/fusos, dinheiro, ssrf, crypto, stremio/addons)
│  │  ├─ scheduler.ts · sse.ts · seed.ts · index.ts
│  └─ web/src/
│     ├─ pages/         (Feed, Library, Explore, Title, Calendar, Wishlist, Sources, Settings)
│     ├─ components/    (ui, AppShell, feed, sources, games, stremio, settings)
│     ├─ lib/           (api, queries, realtime, theme, utils, stremio)
│     └─ styles/index.css
├─ packages/shared/src/ (tipos, constantes, schemas Zod)
├─ data/                (SQLite — criado em runtime, ignorado pelo git)
└─ .env.example
```

---

## Dados de demonstração

No primeiro boot, com `HUB_SEED_DEMO=true`, são criadas 10 fontes fictícias, 34 itens em todas as categorias e 5 jogos com 30 dias de histórico de preços. Elas têm o selo **demo**, não entram na atualização automática (próxima verificação em 7 dias) e podem ser removidas em **Configurações → Dados de demonstração**.

Para começar limpo:

```env
HUB_SEED_DEMO=false
```

e remova as fontes demo pela interface (ou apague `data/hub.db` para zerar tudo).

---

## Segurança e privacidade

- Servidor escuta em `127.0.0.1` por padrão.
- Sem login: é um app pessoal local.
- Chaves de API no SQLite local ou no `.env`; **nunca no código**. A API expõe apenas status e máscara.
- As rotas de chaves, de conta do Stremio e de addons só aceitam requisições do próprio computador, mesmo com `HOST=0.0.0.0`.
- O banco (`data/`), o `.env` e os arquivos `*.db` são ignorados pelo git.
- **Stremio:** a senha é usada uma única vez e nunca é gravada nem logada. O `authKey` é persistido com AES-256-GCM usando `APP_SECRET` e nunca é devolvido pela API. Trocar o `APP_SECRET` invalida a sessão salva (basta reconectar).
- **Addons:** a URL do manifest é criptografada com AES-256-GCM (`APP_SECRET`), nunca volta pela API (apenas `host/••••/manifest.json`) e não aparece em logs. Como você cadastra a URL manualmente, addons em localhost/LAN são permitidos; destinos de metadados de nuvem ficam bloqueados. Redirects são validados.
- A API nunca devolve URLs completas de streams no diagnóstico: só tipo, qualidade, tamanho, seeds e contagens.
- Não há criptografia em repouso para as chaves de API no SQLite; o arquivo fica na sua máquina.
- URLs fornecidas pelo usuário para fontes passam por validação de protocolo e bloqueio de IPs privados (SSRF). Addons seguem a regra própria acima.
- Mensagens de erro de conectores removem a query string das URLs, para não vazar chaves em logs.
- Descrições de RSS são convertidas em texto puro (nada de HTML cru).
- Thumbnails usam `referrerpolicy="no-referrer"`.

---

## Solução de problemas

**Porta em uso** — mude `PORT` no `.env` e o `target` do proxy em `apps/web/vite.config.ts` (ou pare o processo antigo: `netstat -ano | findstr :4000`).

**`Cannot find module 'node:sqlite'`** — você está em Node < 22.5. Atualize o Node.

**Feed vazio depois de adicionar uma fonte** — abra **Fontes**, clique em *Histórico* e veja o erro. Causas comuns: URL de canal errada, feed inexistente, site bloqueando o User-Agent.

**YouTube mostra “Endereço não encontrado (HTTP 404)”** — o RSS do YouTube falha para alguns canais. O Hub tenta automaticamente a página `/videos` do canal. Se o erro persistir, confira se o canal é público e tem vídeos; depois clique em **Atualizar agora** na fonte.

**YouTube não resolve o canal** — prefira a URL `youtube.com/channel/UC…`; handles funcionam, mas dependem do HTML público.

**Banco corrompido / quero recomeçar** — pare o app e apague `data/hub.db*` (o arquivo `-wal` e `-shm` também).

**Fonte TMDB mostra erro de autenticação** — salve a chave em **Configurações → Chaves de API** (ou no `.env`) e teste de novo. A chave v3 (query param) e o Read Access Token v4 (Bearer) são aceitos.

**Novel não carrega / “não liberou a página”** — o Minha Bolha abre a página no Chromium do próprio Electron, em uma janela oculta. Confirme se é a **página principal da obra** (não a página de um capítulo). Alguns sites usam proteção anti-bot muito restritiva e podem recusar o acesso; nesse caso, a fonte fica com erro isolado e as demais continuam funcionando. Não é preciso instalar Chrome nem Edge.

**Jogos sem preço** — salve a chave do gg.deals em **Configurações → Chaves de API**. A fonte “Preços · gg.deals” é criada/reativada automaticamente. O limite gratuito é de 100 registros/min e 1000/h; bibliotecas grandes são processadas aos poucos (até 400 por execução).

**Calendário vazio** — o calendário global é criado automaticamente e sincroniza ao iniciar e a cada 6h. Clique em **Atualizar** ou confira a fonte **Calendário global** em Fontes. Se o TMDB estiver sem chave, filmes/séries não entram (animes continuam via AniList). Filmes/séries usam ~45 dias atrás e ~75 à frente; animes usam ~30 dias à frente; séries em exibição usam os próximos 7 dias.

**Jogos com nome “Jogo 123…” / sem capa** — a API `appdetails` da Steam recusa lotes. O conector agora consulta um appid por vez; uma nova sincronização da wishlist corrige os nomes e capas. Se persistir, o log mostra um aviso de metadados.

**Busca do calendário sem resultado** — a busca considera o escopo selecionado (**Global** ou **Minha biblioteca**) e os dados já sincronizados. Tente o outro escopo, confira a grafia ou clique em Atualizar. A busca ignora acentos e maiúsculas.

**Link `/id/nome` não é reconhecido** — a chave da Steam não é mais configurada no app. Prefira o **SteamID64** (17 dígitos) ou o link `steamcommunity.com/profiles/…`. O perfil e a wishlist precisam ser públicos.

**Episódio não apareceu no feed na hora** — episódios com horário exato (AniList) viram item só depois de irem ao ar; a próxima sincronização (3 h) materializa. TMDB só informa a data, sem horário.

**"Este título já está sendo acompanhado"** — cada filme/série/anime pode estar em apenas uma fonte. Edite a fonte existente ou remova-a antes de adicionar de novo.

**A wishlist da Steam veio vazia / erro `private`** — o perfil e a lista de desejos precisam ser públicos (Steam → Perfil → Editar perfil → Privacidade). Desative também “Sempre manter detalhes do jogo privados”.

**O desconto não bate com a loja** — o percentual é calculado sobre o **preço base da Steam**. O gg.deals pode ter uma oferta oficial mais barata que a própria Steam.

**Jogo removido da wishlist continua aparecendo** — é intencional: ele sai do filtro “Na wishlist” mas permanece na biblioteca para continuar monitorando o preço. Use “Remover” no detalhe para apagar.

**Wishlist com “Falha na requisição (HTTP 502)”** — o backend estava indisponível (por exemplo, durante um restart). A tela agora explica e tem **Tentar novamente**; confira se `npm run dev` está rodando.

**Stremio: “Sessão expirada”** — o token foi recusado. Clique em **Reconectar** em Configurações → Stremio e entre de novo (ou cole uma nova chave de acesso).

**Stremio: “Configure APP_SECRET”** — adicione `APP_SECRET=` com pelo menos 16 caracteres no `.env` e reinicie a API. Se você trocar o valor depois, será preciso reconectar a conta.

**Torrent não toca / “Preparando torrent…” demora** — o motor embutido precisa de peers para baixar os metadados e o primeiro segmento. Verifique os seeds, aguarde e tente outro stream. Se o preparo falhar, o Hub tenta o **Stremio Server** como fallback opcional (abra o Stremio e defina `STREMIO_SERVER_URL` se estiver em outra porta). Streams diretos/HLS não dependem de torrent.

**Nenhum stream encontrado** — os addons podem estar desativados, exigir configuração ou limitar requisições (429/401). Confira **Configurações → Addons**, teste o addon e tente novamente; um addon com erro não bloqueia os demais.

**FrostStream: HTTP 401** — a URL pública não fornece streams. Crie uma conta no FrostStream pelo link **Configurar** exibido no seletor, copie o **manifest pessoal** e substitua a URL do addon em **Configurações → Addons**. A conta FrostStream é independente da conta Stremio.

**Sem legendas / “página HTML em vez de JSON”** — use o addon **OpenSubtitles v3**. O addon antigo “OpenSubtitles” (v0.24.0) está descontinuado e responde com uma página HTML; ele pode ficar desativado sem afetar o v3. As legendas baixadas são convertidas para WebVTT pelo próprio Hub, sem depender de CORS do site de origem.

**Menu de áudio não aparece** — ele só é exibido quando o ffprobe do motor embutido encontra 2+ faixas. Arquivos com uma faixa só tocam no áudio padrão. Em streams diretos com múltiplas faixas, o navegador não expõe troca; o Hub usa HLS para esse caso. A troca recarrega o HLS no áudio escolhido, então o primeiro carregamento pode demorar alguns segundos.

**Atalhos do player** — funcionam com a aba do Hub em foco, sem precisar clicar no vídeo: **F** tela cheia, **←/→** avanço/retrocesso configurável, **↑/↓** volume, **M** mudo, **K/Espaço** play/pause. Eles são ignorados enquanto você digita em um campo de texto ou usa o slider de volume; clique fora do campo para voltar a usá-los.

**Tela de detalhes sem temporadas** — o TMDB não encontrou o título ou a chave não está configurada. Confira a chave em Configurações → Chaves de API. No player, ajuste temporada/episódio manualmente no seletor de streams.

**Stremio não conecta com Facebook/Apple** — essas contas precisam da chave de acesso manual (instruções na própria seção Stremio).

**Addon retorna 401/403** — ele exige configuração, login ou sua região não é aceita. Use a URL configurada do addon (a que você usa no Stremio) e confira o diagnóstico.

**Addon não aparece em Explorar** — ele pode não declarar o recurso `catalog` ou estar desativado. O diagnóstico mostra os recursos do manifest.

**Catálogo desabilitado em Explorar** — ele exige extras que a Etapa 2 não preenche (ex.: `calendarVideosIds`, `lastVideosIds`, `genre`). Use outro catálogo ou o addon no Stremio; a Etapa 3 pode ampliar isso.

**Teste do addon sem streams** — alguns addons só fornecem catálogo/metadados. Outros exigem configuração; o resumo mostra o motivo. O player reproduz streams diretos, HLS e torrents pelo motor embutido.

**Importar addons da conta** — é somente leitura e ignora duplicatas. A conta do Stremio não é alterada.

---

## Roadmap

| Fase | Entrega |
|---|---|
| **1 ✅** | Estrutura, banco, feed, abas, lido/favorito, fontes, YouTube, RSS |
| **2 ✅** | TMDB (link do IMDB/busca) + AniList + calendário mensal e próximos 30 dias |
| **3 ✅** | Wishlist Steam + gg.deals, tela de jogos, histórico, alertas de preço |
| **Stremio ✅** | Conta somente leitura, biblioteca, “Continuar assistindo”, importação e detalhes no app |
| **Addons ✅** | Cadastro manual, importação da conta, catálogos, Explorar e diagnóstico |
| **Player (Etapa 3)** | ✅ Lista de streams, player no Feed/detalhes, legendas, faixas de áudio, motor de torrent embutido, progresso local/retomada e próximo episódio |
| **4 ✅** | Novels em vários sites: capa, último capítulo, data/hora e progresso de leitura |
| **5 ⏳** | Links personalizados ✅ · empacotamento NSIS + portátil ✅ · IA opcional e polimento pendentes |

### Empacotamento

```bash
npm run dist
```

Gera em `release/`:

- **Instalador:** `Minha-Bolha-Setup-0.4.0.exe` — instala por usuário em `%LOCALAPPDATA%\Programs\Minha Bolha`.
- **Portátil:** `Minha-Bolha-Portable-0.4.0.zip` — extraia em uma pasta gravável e execute `Minha Bolha.exe`. Não instala nada.

As duas versões são independentes:

- instalado guarda dados em `%APPDATA%\Minha Bolha`;
- portátil guarda dados em `data\` ao lado do `.exe` (por causa do `portable.txt`);
- cada instância escolhe uma porta livre para a API, então instalado e portátil podem rodar ao mesmo tempo;
- o pacote já inclui Electron, frontend, API, FFmpeg, FFprobe e o Chromium usado por novels/navegador auxiliar. Não exige Node, npm, Chrome ou Edge instalados.

O instalador não é assinado digitalmente; o Windows pode exibir um aviso do SmartScreen. O desinstalador preserva os dados em `%APPDATA%\Minha Bolha` (`deleteAppDataOnUninstall: false`).

---

## Atualizações

O app verifica o **GitHub Releases** ao abrir e também pelo botão **Verificar atualizações** no rodapé de Configurações.

### Configurar o repositório

Edite apenas `apps/desktop/update-config.cjs`:

```js
module.exports = {
  owner: 'marciliofilho',
  repo: 'minha-bolha',
  ...
};
```

O repositório já está configurado como `marciliofilho/minha-bolha`. Para usar outro, edite apenas `apps/desktop/update-config.cjs`.

### Publicar uma versão

```bash
npm run dist
```

Publique na release do GitHub:

- `Minha-Bolha-Setup-<versão>.exe`
- `Minha-Bolha-Setup-<versão>.exe.blockmap`
- `latest.yml`
- `Minha-Bolha-Portable-<versão>.zip`

O `latest.yml` é gerado pelo electron-builder e é obrigatório para o `electron-updater`.

### Como cada versão atualiza

- **Instalado:** o `electron-updater` baixa o instalador NSIS e instala por cima. Os dados em `%APPDATA%\Minha Bolha` são preservados.
- **Portátil:** o app baixa o ZIP portátil e um script aguarda o app fechar, substitui os arquivos da pasta atual e reabre. A pasta `data\` não vem no ZIP, então configurações, banco e cookies são mantidos.

O instalador não é assinado; o Windows pode exibir o aviso do SmartScreen durante a atualização.

---

## Licença

O Minha Bolha é software livre sob a **GNU General Public License v3.0 only** (`GPL-3.0-only`).

Copyright (C) 2026 Minha Bolha (My Bubble). “Minha Bolha” e “My Bubble” são nomes do projeto.

- Você pode usar, estudar, modificar, redistribuir e comercializar o app.
- Ao distribuir o app ou uma versão modificada, você precisa disponibilizar o **código-fonte completo correspondente** sob a GPL-3.0 e manter os avisos de copyright.
- Não é permitido adicionar restrições que reduzam os direitos garantidos pela GPL.
- O texto completo está em [LICENSE](LICENSE).
- Os créditos do projeto estão em [NOTICE](NOTICE).
- As licenças de Electron, FFmpeg e demais componentes estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

O código-fonte do projeto é público. Ao distribuir o instalador ou o portátil, o repositório público cumpre a exigência de disponibilização do código correspondente.

---

## Avisos

- Preços por **gg.deals** — a API gratuita é para uso pessoal, exige atribuição e não permite alterar links de afiliado. O app exibe “Preços por gg.deals” com link ativo nas telas que usam esses dados.
- A API gratuita do gg.deals retorna o **menor preço por mercado**, não ofertas por loja. O clique no preço abre a página do jogo no gg.deals, onde a oferta é exibida; não é possível linkar diretamente a loja com a API gratuita.
- A API de conta do **Stremio** não é oficial e pode mudar sem aviso. O conector é **somente leitura**; o Hub nunca adiciona ou remove itens da sua biblioteca.
- **Addons** usam o protocolo público do Stremio, mas cada um pode exigir configuração, limitar regiões ou bloquear o acesso. O Hub não instala código e não garante disponibilidade dos streams.
- Catálogos com extras obrigatórios não suportados na Etapa 2 aparecem desabilitados em **Explorar**.
- O scraping de **novels** é sensível a mudanças de layout e proteção anti-bot. A Webnovel tem um extrator dedicado; os demais sites usam heurísticas (JSON-LD, dados embutidos e lista de capítulos). O Minha Bolha usa o **Chromium do próprio Electron** (via CDP, em processo auxiliar oculto), sem baixar Chrome ou depender do Edge. Nenhuma conta ou senha é usada.
- Este projeto não é afiliado ao YouTube, TMDB, AniList, Steam, gg.deals, Stremio ou Webnovel.
