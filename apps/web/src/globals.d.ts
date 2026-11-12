/** Versão do app injetada pelo Vite a partir do package.json da raiz. */
declare const __APP_VERSION__: string;

/**
 * Ponte injetada pelo shell Android (WebView).
 *
 * Existe apenas no app Android; no desktop e no navegador fica indefinida.
 */
interface HubNativeBridge {
  playTorrent(payload: string): void;
  openBrowser(url?: string): void;
  isAvailable(): boolean;
}

interface Window {
  HubNative?: HubNativeBridge;
}
