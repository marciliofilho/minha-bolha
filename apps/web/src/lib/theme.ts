/** Aplica o tema (escuro, claro ou sistema) no <html>. */
import { useEffect } from 'react';
import type { SettingsDto } from '@hub/shared';

export function useTheme(mode: SettingsDto['theme']): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = (): void => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches);
      document.documentElement.classList.toggle('light', !dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#07090e' : '#f5f6fa');
    };

    apply();

    if (mode === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [mode]);
}
