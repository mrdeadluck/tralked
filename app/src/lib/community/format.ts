const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// America/Sao_Paulo has had no daylight saving time since 2019.
const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;

/**
 * Deterministic pt-BR date for community content, e.g. "31 out 2026" or "31 out 2026, 14:05"
 * (São Paulo time). It does not depend on "now" or on the runtime's Intl data, so the server
 * render and the browser hydration always agree.
 */
export function formatWhen(date: Date | string, withTime = false): string {
  const local = new Date(new Date(date).getTime() + SAO_PAULO_OFFSET_MS);
  const day = `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
  if (!withTime) return day;
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${day}, ${hh}:${mm}`;
}

/** "1 resposta", "3 respostas". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}
