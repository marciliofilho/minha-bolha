/** Primitivas de interface do Hub. */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { cn, categoryColor } from '@/lib/utils';
import { SYSTEM_CATEGORIES } from '@hub/shared';
import { AppIcon } from './AppIcon';

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'subtle' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-lg shadow-accent/20 hover:brightness-110',
  subtle: 'bg-elevated text-fg border border-line hover:border-accent/50 hover:bg-elevated/80',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20'
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm'
};

export function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: 'default' | 'danger' | 'accent';
}

export function IconButton({ label, active, tone = 'default', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition',
        'text-faint hover:bg-elevated hover:text-fg',
        active && tone === 'accent' && 'text-accent hover:text-accent',
        active && tone === 'danger' && 'text-danger hover:text-danger',
        active && tone === 'default' && 'text-warning hover:text-warning',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chips e badges
// ---------------------------------------------------------------------------

export function Chip({
  children,
  color,
  className
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-line/80 bg-elevated/70 px-1.5 py-0.5 text-[10px] font-medium text-muted',
        className
      )}
      style={color ? { color, borderColor: `${color}33`, backgroundColor: `${color}14` } : undefined}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: 'ok' | 'error' | 'paused' | 'unknown' }) {
  const palette = {
    ok: 'bg-success',
    error: 'bg-danger',
    paused: 'bg-faint',
    unknown: 'bg-warning'
  } as const;
  return <span className={cn('inline-block h-2 w-2 rounded-full', palette[tone])} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Interruptor
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-accent/50 bg-accent/80' : 'border-line bg-elevated'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 rounded-full bg-white shadow transition',
          checked ? 'left-[1.15rem]' : 'left-0.5'
        )}
        style={{ height: '1.125rem', width: '1.125rem' }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Estrutura de página
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-5 py-10 text-center sm:px-6 sm:py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-elevated text-accent">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  htmlFor,
  children
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

export function SuccessNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

export function InfoBanner({
  message,
  action
}: {
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent/8 px-3 py-2.5 text-xs text-muted">
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Miniatura com fallback (funciona offline)
// ---------------------------------------------------------------------------

export function Thumb({
  src,
  categoryId,
  kind,
  className,
  alt
}: {
  src: string | null;
  categoryId: string;
  kind: string;
  className?: string;
  alt: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const color = categoryColor(categoryId);
  const categoryIcon = SYSTEM_CATEGORIES.find((category) => category.id === categoryId)?.icon ?? 'rss';
  const showFallback = !src || failedSrc === src;

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line/70 bg-elevated', className)}>
      {showFallback ? (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            backgroundImage: `linear-gradient(135deg, ${color}26, ${color}08 60%, transparent)`
          }}
        >
          <span style={{ color }}>
            <AppIcon name={categoryIcon} className="h-6 w-6" />
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
        />
      )}
      {kind === 'video' || kind === 'episode' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      ) : null}
    </div>
  );
}
