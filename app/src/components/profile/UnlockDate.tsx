import { formatDate } from "./format";

/** When an achievement was earned; "data desconhecida" when the platform gave no date (old Steam ones). */
export function UnlockDate({ date }: { date: Date | null }) {
  return date ? <time dateTime={date.toISOString()}>{formatDate(date)}</time> : <span>data desconhecida</span>;
}
