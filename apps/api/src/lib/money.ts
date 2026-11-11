/** Formatação e cálculo de dinheiro (sempre em centavos no banco). */
export function formatMoney(cents: number | null | undefined, currency = 'BRL'): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Desconto percentual de um preço em relação ao preço base. */
export function discountPercent(price: number | null | undefined, base: number | null | undefined): number {
  if (!price || !base || base <= 0 || price >= base) return 0;
  return Math.round((1 - price / base) * 100);
}

/** Converte "79,90" / "79.90" / "1.234,56" em centavos. */
export function parseMoneyToCents(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  let normalized = value.trim().replace(/[^\d.,-]/g, '');
  if (!normalized) return null;

  if (normalized.includes(',') && normalized.includes('.')) {
    // O separador que aparece por último é o decimal ("1.234,56" ou "1,234.56").
    normalized =
      normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  } else if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length > 2 || parts[1]?.length === 3) {
      normalized = parts.join('');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}
