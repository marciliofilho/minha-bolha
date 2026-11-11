/** String persistida no localStorage (preferências de UI do Feed). */
import { useCallback, useState } from 'react';

export function useStoredString(
  key: string,
  fallback: string
): [string, (value: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Armazenamento indisponível.
      }
    },
    [key]
  );

  return [value, update];
}
