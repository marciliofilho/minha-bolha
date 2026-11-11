const update = require('./update-config.cjs');

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
    { from: '../../node_modules/ffmpeg-static/ffmpeg.exe', to: 'bin/ffmpeg.exe' },
    {
      from: '../../node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe',
      to: 'bin/ffprobe.exe'
    },
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
