import { useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * Long-press para toque (e clique direito no mouse) sem disparar o clique do
 * card. Usado no Android para abrir a prévia que no desktop aparece no hover.
 */
export function useLongPress(onLongPress?: () => void, delay = 550) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = (event: PointerEvent<HTMLElement>): void => {
    if (!onLongPress || event.pointerType === 'mouse') return;
    clear();
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, delay);
  };

  const cancel = (): void => clear();

  const click = (event: MouseEvent<HTMLElement>): void => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const context = (event: MouseEvent<HTMLElement>): void => {
    if (!onLongPress) return;
    event.preventDefault();
    if (fired.current) return;
    onLongPress();
  };

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture: click,
    onContextMenu: context
  };
}
