import Link from "next/link";
import { formatCompact, formatExact } from "@/lib/xp-format";

type XpBarProps = {
  level: number;
  /** XP earned inside the current level. */
  current: number;
  /** XP the current level spans. */
  next: number;
  /** Shows the "Como funciona o XP" link (the character sheet; off in compact places). */
  explain?: boolean;
};

/**
 * Progress inside the current level: the percentage carries the story, the remaining XP is
 * abbreviated ("faltam 1,2 mi XP") and the exact numbers sit in the tooltip.
 */
export function XpBar({ level, current, next, explain = true }: XpBarProps) {
  const fraction = next > 0 ? Math.min(1, current / next) : 0;
  const percent = Math.floor(fraction * 100);
  const left = Math.max(0, next - current);
  return (
    <div>
      <div
        role="progressbar"
        aria-label={`Progresso para o nível ${level + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, faltam ${formatExact(left)} XP`}
        title={`${formatExact(current)} de ${formatExact(next)} XP neste nível`}
        className="h-2.5 overflow-hidden rounded-[2px] bg-track"
      >
        <i
          className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.16,1,.3,1)] starting:w-0"
          style={{ width: `${(fraction * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 font-mono text-xs text-dim">
        <span>
          <b className="font-bold text-text tabular-nums">{percent}%</b> do nível {level + 1}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <span title={`Faltam ${formatExact(left)} XP`}>
            faltam <b className="font-bold text-text tabular-nums">{formatCompact(left)}</b> XP
          </span>
          {explain ? (
            <Link
              href="/como-funciona"
              className="inline-flex min-h-6 items-center text-acc underline-offset-[3px] hover:underline"
            >
              Como funciona o XP
            </Link>
          ) : null}
        </span>
      </div>
    </div>
  );
}
