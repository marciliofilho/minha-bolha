/** Relógio compartilhado para atualizar tempos relativos a cada minuto. */
import { useSyncExternalStore } from 'react';

const TICK_MS = 60_000;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: number | null = null;

function subscribe(listener: () => void): () => void {
  if (Date.now() - now >= TICK_MS / 2) now = Date.now();
  listeners.add(listener);

  if (timer === null) {
    timer = window.setInterval(() => {
      now = Date.now();
      for (const callback of listeners) callback();
    }, TICK_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** Retorna o horário atual e re-renderiza o componente a cada minuto. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
