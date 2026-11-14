/** Lista vazia não é resultado confiável; pode ser addon lento ou bloqueado. */
export function isCacheableStreamList<T>(
  streams: T[] | null | undefined
): streams is T[] {
  return Array.isArray(streams) && streams.length > 0;
}
