/** Logger simples com horário, nível e contexto. */
type Level = 'info' | 'warn' | 'error' | 'debug';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

function format(level: Level, scope: string, message: string, extra?: unknown): string {
  const time = new Date().toISOString().slice(11, 19);
  const suffix = extra === undefined ? '' : ` ${safeJson(extra)}`;
  return `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function log(level: Level, scope: string, message: string, extra?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = format(level, scope, message, extra);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => log('debug', scope, message, extra),
    info: (message: string, extra?: unknown) => log('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => log('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => log('error', scope, message, extra)
  };
}

export type Logger = ReturnType<typeof createLogger>;
