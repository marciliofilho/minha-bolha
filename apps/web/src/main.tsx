import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { isAndroidShell } from './lib/platform';
import './styles/index.css';

// Marca o shell Android para ajustes de CSS/interação (hover, área segura).
if (isAndroidShell()) {
  document.documentElement.dataset.platform = 'android';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 20_000
    }
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>
);
