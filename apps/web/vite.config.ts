import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

// O shell Android injeta a versão do Gradle (versionName) para que a tela
// Sobre mostre a mesma versão do backend (/api/health). No desktop e no
// navegador continua valendo o package.json da raiz.
const appVersion = process.env.HUB_APP_VERSION?.trim() || appPackage.version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@hub/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // O shell Android define HUB_BUILD_TARGET=es2019 para WebViews antigos
    // (BlueStacks/emuladores). No desktop o padrão do Vite continua valendo.
    target: process.env.HUB_BUILD_TARGET || 'modules'
  }
});
