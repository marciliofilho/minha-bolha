/** Carrossel horizontal com setas e arrastar com o mouse (usado no modo Netflix). */
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export function HorizontalScroller({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false, pointerId: null as number | null });
  const [arrows, setArrows] = useState({ left: false, right: false });

  const updateArrows = (): void => {
    const element = scroller.current;
    if (!element) return;
    const left = element.scrollLeft > 4;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setArrows((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
  };

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    updateArrows();
    const observer = new ResizeObserver(updateArrows);
    observer.observe(element);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  const scrollBy = (direction: 1 | -1): void => {
    const element = scroller.current;
    if (!element) return;
    // 'auto' é proposital: alguns navegadores/webviews ignoram o scroll suave.
    element.scrollBy({ left: direction * Math.max(element.clientWidth * 0.8, 220), behavior: 'auto' });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const element = scroller.current;
    if (!element) return;
    // A captura do ponteiro só é feita quando o arrasto realmente começa.
    // Capturar no pointerdown faria o navegador entregar o clique ao
    // contêiner do carrossel, e os cards nunca abririam.
    drag.current = {
      active: true,
      startX: event.clientX,
      startScroll: element.scrollLeft,
      moved: false,
      pointerId: event.pointerId
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current.active) return;
    const element = scroller.current;
    if (!element) return;
    const delta = event.clientX - drag.current.startX;
    if (!drag.current.moved) {
      if (Math.abs(delta) <= 5) return;
      drag.current.moved = true;
      try {
        element.setPointerCapture(event.pointerId);
        drag.current.pointerId = event.pointerId;
      } catch {
        // alguns navegadores não suportam; segue com o scroll normal
      }
    }
    element.scrollLeft = drag.current.startScroll - delta;
  };

  const endDrag = (): void => {
    if (!drag.current.active) return;
    const wasDragging = drag.current.moved;
    const pointerId = drag.current.pointerId;
    drag.current.active = false;
    if (wasDragging && pointerId !== null) {
      try {
        scroller.current?.releasePointerCapture(pointerId);
      } catch {
        // ignora
      }
    }
    drag.current.pointerId = null;
    updateArrows();
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
    if (!drag.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current.moved = false;
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={scroller}
        className="no-scrollbar flex w-full min-w-0 select-none overflow-x-auto pb-1 active:cursor-grabbing sm:cursor-grab"
        onScroll={updateArrows}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(event) => event.preventDefault()}
        aria-label={t('Carrossel horizontal')}
        role="group"
      >
        <div ref={content} className="flex gap-3">
          {children}
        </div>
      </div>

      {arrows.left ? (
        <button
          type="button"
          aria-label={t('Rolar para a esquerda')}
          onClick={() => scrollBy(-1)}
          className="absolute left-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-fg shadow-lg backdrop-blur transition hover:bg-elevated sm:flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}

      {arrows.right ? (
        <button
          type="button"
          aria-label={t('Rolar para a direita')}
          onClick={() => scrollBy(1)}
          className="absolute right-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-fg shadow-lg backdrop-blur transition hover:bg-elevated sm:flex"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
