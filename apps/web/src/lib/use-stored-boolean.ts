/** Booleano persistido no localStorage (preferências de UI do Feed). */
import { useCallback, useState } from 'react';

export function useStoredBoolean(
  key: string,
  fallback = false
): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return fallback;
      return stored === '1';
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Armazenamento indisponível.
      }
    },
    [key]
  );

  const toggle = useCallback(() => update(!value), [update, value]);

  return [value, toggle, update];
}
