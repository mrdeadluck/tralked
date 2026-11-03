import type { TrophySummary } from "@/lib/character/sheet";
import type { TrophyTier } from "@/lib/engine/trophies";
import { formatNumber } from "./format";
import { Bar, Panel } from "./Panel";
import { PLATFORM_LABEL } from "./platforms";

const TIERS: { tier: TrophyTier; label: string; color: string }[] = [
  { tier: "platinum", label: "Platina", color: "var(--plat)" },
  { tier: "gold", label: "Ouro", color: "var(--gold)" },
  { tier: "silver", label: "Prata", color: "var(--silver)" },
  { tier: "bronze", label: "Bronze", color: "var(--bronze)" },
];

/**
 * Trophies by tier across every platform (Glória's rules: native PSN tier, otherwise rarity;
 * a 100% game counts as a platinum), beside the unlocks per platform as bars.
 */
export function TrophyTiers({ trophies }: { trophies: TrophySummary }) {
  const total = trophies.byPlatform.reduce((sum, p) => sum + p.unlocks, 0);
  const most = Math.max(1, ...trophies.byPlatform.map((p) => p.unlocks));
  return (
    <Panel title="Troféus" aside={`${formatNumber(total)} ${total === 1 ? "conquista" : "conquistas"}`}>
      <div className="@container">
      <div className="grid items-start gap-[18px] @min-[560px]:grid-cols-2">
        <div>
          <ul aria-label="Troféus por nível" className="m-0 grid list-none grid-cols-4 gap-0.5 p-0">
            {TIERS.map(({ tier, label, color }) => (
              <li key={tier} className="grid justify-items-center gap-0.5 bg-surface-2 px-1 py-2.5 text-center">
                <svg viewBox="0 0 26 26" aria-hidden="true" className="size-[26px]">
                  <path
                    d="M8 3h10v5a5 5 0 0 1-10 0zM4.5 4H8v3a3.5 3.5 0 0 1-3.5-3zm17 0H18v3a3.5 3.5 0 0 0 3.5-3zM11.5 13h3v4h-3zM8 18h10v4H8z"
                    style={{ fill: color }}
                  />
                </svg>
                <b className="text-lg leading-[1.1] font-black font-stretch-[110%] tabular-nums">
                  {formatNumber(trophies.tiers[tier])}
                </b>
                <small className="text-[11.5px] text-muted">{label}</small>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Todas as plataformas somadas. Platina: o troféu de platina da PSN ou um 100% nas outras.
          </p>
        </div>
        {trophies.byPlatform.length > 0 ? (
          <dl className="m-0 grid gap-2">
            {trophies.byPlatform.map(({ platform, unlocks }) => (
              <div key={platform} className="grid grid-cols-[112px_minmax(0,1fr)_56px] items-center gap-2.5 text-[13px]">
                <dt className="truncate text-text-2">{PLATFORM_LABEL[platform]}</dt>
                <dd className="m-0 contents">
                  <Bar fraction={unlocks / most} className="h-[5px]" />
                  <span className="text-right font-extrabold tabular-nums">
                    {formatNumber(unlocks)}
                    <span className="sr-only"> {unlocks === 1 ? "conquista" : "conquistas"}</span>
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Nenhuma conquista importada ainda.</p>
        )}
      </div>
      </div>
    </Panel>
  );
}
