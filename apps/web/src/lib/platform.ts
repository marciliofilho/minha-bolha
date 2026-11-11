/**
 * Detecção do shell Android.
 *
 * O app Android carrega a mesma interface do desktop dentro de um WebView. O
 * user agent do WebView contém o token `wv`, então usamos isso (e um fallback
 * por `data-platform`) para desligar comportamentos que só fazem sentido com
 * mouse de verdade.
 */
export function isAndroidShell(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgent.includes('; wv)') || navigator.userAgent.includes(' Version/4.0 ')) {
    return true;
  }
  return document.documentElement.dataset.platform === 'android';
}

/** Hover só em dispositivos com mouse; toque não deve abrir prévias. */
export function supportsHover(): boolean {
  if (typeof window === 'undefined') return false;
  if (isAndroidShell()) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
