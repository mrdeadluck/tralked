import { formatNumber } from "./format";

type XpBarProps = {
  level: number;
  /** XP earned inside the current level. */
  current: number;
  /** XP the current level spans. */
  next: number;
};

export function XpBar({ level, current, next }: XpBarProps) {
  const fraction = next > 0 ? Math.min(1, current / next) : 0;
  const percent = Math.floor(fraction * 100);
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Progresso para o próximo nível"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2.5 overflow-hidden rounded-[2px] bg-track"
      >
        <i
          className="block h-full bg-acc shadow-[0_0_16px_rgba(198,244,50,0.45)] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0"
          style={{ width: `${(fraction * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap justify-between gap-3 font-mono text-xs text-dim">
        <span>
          <b className="font-bold text-text">{percent}%</b> do nível {level + 1}
        </span>
        <span>
          faltam <b className="font-bold text-text">{formatNumber(Math.max(0, next - current))}</b> XP
        </span>
      </div>
    </div>
  );
}
