const path = require('node:path');
const update = require('./update-config.cjs');

const isWindows = process.platform === 'win32';
const exeSuffix = isWindows ? '.exe' : '';
const binaries = {
  ffmpeg: path.join(__dirname, '../../node_modules/ffmpeg-static', `ffmpeg${exeSuffix}`),
  ffprobe: path.join(
    __dirname,
    '../../node_modules/ffprobe-static/bin',
    process.platform,
    process.arch,
    `ffprobe${exeSuffix}`
  )
};

module.exports = {
  appId: 'com.updatehub.desktop',
  productName: 'Minha Bolha',
  copyright: 'Copyright © 2026 Minha Bolha (My Bubble)',

  directories: {
    output: '../../release',
    buildResources: 'build'
  },

  asar: true,
  asarUnpack: ['splash/**'],

  files: [
    'main.cjs',
    'preload.cjs',
    'updater.cjs',
    'update-config.cjs',
    'package.json',
    'splash/**/*',
    'language/**/*',
    'assets/**/*',
    '!**/*.md',
    '!**/*.map'
  ],

  extraResources: [
    { from: '../web/dist', to: 'web' },
    { from: '../api/dist', to: 'api' },
    { from: binaries.ffmpeg, to: `bin/ffmpeg${exeSuffix}` },
    { from: binaries.ffprobe, to: `bin/ffprobe${exeSuffix}` },
    { from: '../../LICENSE', to: 'LICENSE' },
    { from: '../../NOTICE', to: 'NOTICE' },
    { from: '../../THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }
  ],

  publish: [
    {
      provider: 'github',
      owner: update.owner,
      repo: update.repo
    }
  ],

  win: {
    icon: 'build/icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ]
  },

  linux: {
    icon: 'build/icon.png',
    executableName: 'minha-bolha',
    category: 'AudioVideo',
    synopsis: 'Feed, lançamentos, jogos, novels e Stremio em um só lugar.',
    description:
      'Minha Bolha (My Bubble) é um hub local para feeds, lançamentos, preços de jogos, novels e Stremio, com navegador Chromium embutido.',
    maintainer: 'Minha Bolha (My Bubble)',
    target: [
      {
        target: 'AppImage',
        arch: ['x64']
      }
    ],
    artifactName: 'Minha-Bolha-${version}-${arch}.${ext}',
    desktop: {
      entry: {
        Name: 'Minha Bolha',
        Comment: 'Feed, lançamentos, jogos, novels e Stremio',
        Categories: 'AudioVideo;Network;Utility;'
      }
    }
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Minha Bolha',
    artifactName: 'Minha-Bolha-Setup-${version}.${ext}',
    deleteAppDataOnUninstall: false
  }
};
