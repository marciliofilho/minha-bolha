/** Ícone por nome (vindo do banco) usando lucide-react. */
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Film,
  Gamepad2,
  Link2,
  Mic,
  MonitorPlay,
  Newspaper,
  Rss,
  Sparkles,
  Tags,
  Youtube,
  type LucideIcon
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  youtube: Youtube,
  rss: Rss,
  'book-open': BookOpen,
  novel: BookOpen,
  sparkles: Sparkles,
  film: Film,
  'monitor-play': MonitorPlay,
  'gamepad-2': Gamepad2,
  newspaper: Newspaper,
  link: Link2,
  mic: Mic,
  tags: Tags,
  clapperboard: Clapperboard,
  'calendar-days': CalendarDays
};

export function AppIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Rss;
  return <Icon className={className} aria-hidden="true" />;
}
