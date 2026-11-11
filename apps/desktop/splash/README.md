# Splash de abertura do Hub

Intro em vídeo exibida antes da janela principal, usando uma janela Electron transparente, sem moldura e centralizada.

## Arquivos

- `splash-window.cjs` — cria/gerencia a janela transparente e o ciclo de vida.
- `splash.html` — reproduz o vídeo com alpha, fade-in/out e ponto de carregamento.
- `splash-preload.cjs` — ponte IPC mínima (`splashAPI.done`).
- `assets/pt-BR/intro.webm` — intro 1920×1080 em Português (Brasil), VP9 com alpha e áudio.
- `assets/global/intro.webm` — intro para os demais idiomas. Deve ser adicionada nessa pasta.

## Comportamento

1. O splash abre imediatamente quando o Electron fica pronto.
2. A janela principal começa a carregar escondida em paralelo, junto com a API.
3. O splash espera o vídeo terminar (5 s) ou o fallback de 8 s.
4. A janela principal aparece e o splash faz fade-out.

Se o app demorar mais que o vídeo, o último frame fica visível com um ponto ciano pulsando até a janela principal carregar.

## Configuração

No app: **Configurações → Interface → Inicialização**.

- **Mostrar intro ao iniciar** — liga/desliga a animação.
- **Áudio da intro** — liga/desliga o som.

As preferências ficam no SQLite e são lidas pelo Electron antes de a API subir.

O vídeo é escolhido pelo idioma efetivo:

- **Português (Brasil)** → `assets/pt-BR/intro.webm`.
- **English/Español/outros** → `assets/global/intro.webm`.
- Se o idioma do app não estiver definido, o Electron usa o idioma do sistema.
- Se o vídeo do idioma escolhido não existir, o app abre sem animação.

Variáveis de ambiente também funcionam como override:

- `HUB_SPLASH=0` — desativa a intro.
- `HUB_SPLASH=1` — força a intro mesmo se estiver desligada nas configurações.
- `HUB_SPLASH_MUTED=1` — mantém o vídeo, mas sem áudio.

```js
splash = createSplash({
  muted: process.env.HUB_SPLASH_MUTED === '1',
  width: 720,
  height: 405
});
```

Use `fullscreen: true` para ocupar a área útil do monitor.

## Empacotamento

A pasta `apps/desktop/splash` precisa ser incluída no pacote final junto com `assets/intro.webm`. Em electron-builder, inclua-a nos `files`/`extraResources` conforme a estrutura do app.
