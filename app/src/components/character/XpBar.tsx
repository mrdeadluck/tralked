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
 * Progress inside the current level as a segmented lime bar (twenty notches): the percentage
 * carries the story, the remaining XP is abbreviated ("faltam 1,2 mi XP") and the exact numbers
 * sit in the tooltip.
 */
export function XpBar({ level, current, next, explain = true }: XpBarProps) {
  const fraction = next > 0 ? Math.min(1, current / next) : 0;
  const percent = Math.floor(fraction * 100);
  const left = Math.max(0, next - current);
  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="progressbar"
        aria-label={`Progresso para o nível ${level + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, faltam ${formatExact(left)} XP`}
        title={`${formatExact(current)} de ${formatExact(next)} XP neste nível`}
        className="relative h-3 bg-track after:pointer-events-none after:absolute after:inset-0 after:bg-[repeating-linear-gradient(90deg,transparent_0_calc(5%-2px),var(--surface)_calc(5%-2px)_5%)] after:content-['']"
      >
        <i
          className="absolute inset-y-0 left-0 block bg-acc transition-[width] duration-[900ms] ease-[cubic-bezier(.16,1,.3,1)] starting:w-0"
          style={{ width: `${(fraction * 100).toFixed(2)}%` }}
        >
          {fraction > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-[3px] -right-px -bottom-[3px] w-[3px] bg-white shadow-[0_0_10px_var(--acc)]"
            />
          ) : null}
        </i>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13.5px] text-text-2">
        <span>
          <b className="font-extrabold text-text tabular-nums">{percent}%</b> do nível {level + 1}
        </span>
        <span title={`Faltam ${formatExact(left)} XP`}>
          faltam <b className="font-extrabold text-text tabular-nums">{formatCompact(left)}</b> XP
        </span>
      </div>
      {explain ? (
        <Link
          href="/como-funciona"
          className="inline-flex min-h-6 items-center self-start text-[12.5px] font-extrabold font-stretch-[80%] tracking-[0.05em] text-acc uppercase underline-offset-4 hover:underline"
        >
          Como funciona o XP
        </Link>
      ) : null}
    </div>
  );
}
