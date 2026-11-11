/** Rotas da aplicação. */
import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { FeedPage } from '@/pages/FeedPage';
import { useSettings } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime';
import { useTheme } from '@/lib/theme';

const LibraryPage = lazy(() =>
  import('@/pages/LibraryPage').then((module) => ({ default: module.LibraryPage }))
);
const ExplorePage = lazy(() =>
  import('@/pages/ExplorePage').then((module) => ({ default: module.ExplorePage }))
);
const TitlePage = lazy(() =>
  import('@/pages/TitlePage').then((module) => ({ default: module.TitlePage }))
);
const CalendarPage = lazy(() =>
  import('@/pages/CalendarPage').then((module) => ({ default: module.CalendarPage }))
);
const WishlistPage = lazy(() =>
  import('@/pages/WishlistPage').then((module) => ({ default: module.WishlistPage }))
);
const SourcesPage = lazy(() =>
  import('@/pages/SourcesPage').then((module) => ({ default: module.SourcesPage }))
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage }))
);

export function App() {
  const settings = useSettings();
  useRealtime();
  useTheme(settings.data?.theme ?? 'dark');

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<FeedPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="title/:type/:metaId" element={<TitlePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
