/** Tipos consultados no agregador de streams. */
export function streamQueryTypes(type: string): string[] {
  // Addons de anime esperam type=anime; addons de torrent costumam usar
  // type=series. Consultar os dois e mesclar cobre os dois comportamentos.
  return type === 'anime' ? ['anime', 'series'] : [type];
}
