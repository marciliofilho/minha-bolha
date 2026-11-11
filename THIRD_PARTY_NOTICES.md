# Avisos de terceiros

O Minha Bolha (My Bubble) é distribuído sob a GNU General Public License v3.0
(`GPL-3.0-only`). Os componentes abaixo mantêm suas próprias licenças.

## Componentes principais

| Componente | Versão | Licença | Código-fonte |
|---|---|---|---|
| Electron | 40.10.6 | MIT | <https://github.com/electron/electron> |
| Chromium | (embutido no Electron) | BSD-3-Clause e outras | `LICENSES.chromium.html` no pacote |
| Node.js | (embutido no Electron) | MIT | <https://github.com/nodejs/node> |
| FFmpeg (`ffmpeg-static`) | 5.3.0 | GPL-3.0-or-later | <https://github.com/eugeneware/ffmpeg-static> e <https://ffmpeg.org> |
| FFprobe (`ffprobe-static`) | 3.1.0 | MIT (pacote); binário do FFmpeg sob GPL | <https://github.com/joshwnj/ffprobe-static> e <https://ffmpeg.org> |
| node-datachannel | 0.32.3 | MPL-2.0 | <https://github.com/murat-dogan/node-datachannel> |
| puppeteer-core | 25.x | Apache-2.0 | <https://github.com/puppeteer/puppeteer> |
| WebTorrent | 3.x | MIT | <https://github.com/webtorrent/webtorrent> |
| Express | 5.x | MIT | <https://github.com/expressjs/express> |
| zod | 3.x | MIT | <https://github.com/colinhacks/zod> |
| fast-xml-parser | 4.x | MIT | <https://github.com/NaturalIntelligence/fast-xml-parser> |
| dotenv | 16.x | BSD-2-Clause | <https://github.com/motdotla/dotenv> |
| electron-updater | 6.x | MIT | <https://github.com/electron-userland/electron-builder> |
| semver | 7.x | ISC | <https://github.com/npm/node-semver> |
| React / React DOM | 19.x | MIT | <https://github.com/facebook/react> |
| React Router | 7.x | MIT | <https://github.com/remix-run/react-router> |
| TanStack Query | 5.x | MIT | <https://github.com/TanStack/query> |
| lucide-react | 0.513.x | ISC | <https://github.com/lucide-icons/lucide> |
| hls.js | 1.7.x | Apache-2.0 | <https://github.com/video-dev/hls.js> |
| Tailwind CSS | 4.x | MIT | <https://github.com/tailwindlabs/tailwindcss> |

A lista completa de dependências e versões está em `package-lock.json`.
Cada pacote mantém a licença indicada no próprio `package.json`.

## FFmpeg

O Minha Bolha inclui um binário do FFmpeg construído pelo pacote
`ffmpeg-static`, licenciado sob **GPL-3.0-or-later**.

O código-fonte correspondente do FFmpeg pode ser obtido em:

- <https://ffmpeg.org/download.html>
- <https://github.com/eugeneware/ffmpeg-static> (scripts de build e versão usada)

O código-fonte também pode ser solicitado ao mantenedor do projeto.

## Electron e Chromium

O instalador inclui os arquivos `LICENSE.electron.txt` e
`LICENSES.chromium.html`, com os textos de licença do Electron e do Chromium.

## Marcas

“Minha Bolha” e “My Bubble” são nomes do projeto. As licenças de terceiros
não concedem permissão para usar essas marcas.
