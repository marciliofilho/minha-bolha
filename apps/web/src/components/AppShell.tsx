/** Casca do app: navegação lateral no desktop e barra inferior no mobile. */
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarDays,
  Compass,
  Gamepad2,
  Inbox,
  Library,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Rss,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCounts } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { appBrand } from '@/lib/brand';
import { useStoredBoolean } from '@/lib/use-stored-boolean';
import { UpdateNotifications } from '@/components/UpdateNotifications';
import { UpdateDialog } from '@/components/UpdateDialog';

const NAV_ITEMS = [
  { to: '/', label: 'Feed', icon: Inbox, end: true },
  { to: '/library', label: 'Biblioteca', icon: Library },
  { to: '/explore', label: 'Explorar', icon: Compass },
  { to: '/calendar', label: 'Calendário', icon: CalendarDays },
  { to: '/wishlist', label: 'Wishlist', icon: Gamepad2 },
  { to: '/sources', label: 'Fontes', icon: Rss },
  { to: '/settings', label: 'Config', icon: Settings }
];

function Logo({ collapsed }: { collapsed: boolean }) {
  const { language } = useI18n();
  const brand = appBrand(language);
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={brand.logo}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-9 w-9 shrink-0 select-none object-contain drop-shadow-[0_4px_14px_rgba(139,92,246,0.35)]"
      />
      {!collapsed ? (
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-fg">{brand.name}</p>
          <p className="mt-0.5 text-[10px] font-normal tracking-normal text-faint">
            v{__APP_VERSION__}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { t } = useI18n();
  const counts = useCounts();
  const [sidebarCollapsed, toggleSidebar] = useStoredBoolean('hub.sidebar.collapsed', false);
  const unread = counts.data?.find((count) => count.id === 'all')?.unread ?? 0;

  return (
    <div className="min-h-screen">
      <UpdateNotifications />
      <UpdateDialog />
      {/* Desktop */}
      <aside
        id="app-sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line/80 bg-surface/60 px-3 py-5 backdrop-blur-xl transition-[width] duration-200 lg:flex',
          sidebarCollapsed ? 'w-20' : 'w-60'
        )}
      >
        <div className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : 'px-2')}>
          <Logo collapsed={sidebarCollapsed} />
        </div>

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={t(sidebarCollapsed ? 'Expandir menu' : 'Recolher menu')}
          aria-expanded={!sidebarCollapsed}
          aria-controls="app-sidebar"
          title={t(sidebarCollapsed ? 'Expandir menu' : 'Recolher menu')}
          className="absolute -right-4 top-[22px] z-50 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-accent shadow-lg shadow-black/30 transition hover:border-accent/60 hover:bg-accent/10 hover:text-fg"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={sidebarCollapsed ? t(item.label) : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center rounded-xl text-sm font-medium transition',
                  sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5',
                  isActive
                    ? 'bg-accent/10 text-fg ring-1 ring-inset ring-accent/20'
                    : 'text-muted hover:bg-elevated hover:text-fg'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0',
                      isActive ? 'text-accent' : 'text-faint group-hover:text-muted'
                    )}
                  />
                  {!sidebarCollapsed ? (
                    <span className="flex-1">{t(item.label)}</span>
                  ) : null}
                  {item.to === '/' && unread > 0 ? (
                    sidebarCollapsed ? (
                      <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent" />
                    ) : (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Conteúdo */}
      <div
        className={cn(
          'transition-[padding] duration-200',
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-60'
        )}
      >
        <div className="mx-auto w-full min-w-0 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
          <Suspense
            fallback={
              <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-faint" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </div>

      {/* Mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface/85 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 overflow-hidden rounded-lg px-0.5 py-1.5 text-[9px] font-medium transition',
                  isActive ? 'text-accent' : 'text-faint'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="h-5 w-5" />
                  <span>{t(item.label)}</span>
                  {item.to === '/' && unread > 0 ? (
                    <span className="absolute right-2 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-fg">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
