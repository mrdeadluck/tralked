import { Card } from "@/components/ui/Card";
import type { TrophySummary } from "@/lib/character/sheet";
import type { TrophyTier } from "@/lib/engine/trophies";
import { CardHead } from "./CardHead";
import { formatNumber } from "./format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "./platforms";

const TIERS: { tier: TrophyTier; label: string; color: string }[] = [
  { tier: "platinum", label: "Platina", color: "var(--plat)" },
  { tier: "gold", label: "Ouro", color: "var(--gold)" },
  { tier: "silver", label: "Prata", color: "var(--silver)" },
  { tier: "bronze", label: "Bronze", color: "var(--bronze)" },
];

/**
 * Trophies by tier across every platform (Glória's rules: native PSN tier, otherwise rarity;
 * a 100% game counts as a platinum), plus the unlocks per platform.
 */
export function TrophyTiers({ trophies }: { trophies: TrophySummary }) {
  const total = trophies.byPlatform.reduce((sum, p) => sum + p.unlocks, 0);
  return (
    <Card>
      <CardHead title="Troféus" aside={`${formatNumber(total)} ${total === 1 ? "conquista" : "conquistas"}`} />
      <ul
        aria-label="Troféus por nível"
        className="m-0 mt-4 grid list-none grid-cols-4 gap-px border border-line bg-line p-0"
      >
        {TIERS.map(({ tier, label, color }) => (
          <li key={tier} className="bg-surface-2 px-1.5 py-2.5 text-center">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="mx-auto size-5">
              <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
            </svg>
            <b className="block text-xl leading-[1.1] font-black font-stretch-[112%] tabular-nums">
              {formatNumber(trophies.tiers[tier])}
            </b>
            <small className="font-mono text-[9.5px] tracking-[0.1em] text-dim uppercase">{label}</small>
          </li>
        ))}
      </ul>
      {trophies.byPlatform.length > 0 ? (
        <dl className="m-0 mt-4 flex flex-col gap-2">
          {trophies.byPlatform.map(({ platform, unlocks }) => (
            <div key={platform} className="flex items-center justify-between gap-3 text-sm">
              <dt className="flex items-center gap-2 text-text-2">
                <span aria-hidden="true" className="size-[7px]" style={{ background: PLATFORM_TOKEN[platform] }} />
                {PLATFORM_LABEL[platform]}
              </dt>
              <dd className="m-0 font-mono text-xs text-dim tabular-nums">
                {formatNumber(unlocks)} {unlocks === 1 ? "conquista" : "conquistas"}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted">Nenhuma conquista importada ainda.</p>
      )}
    </Card>
  );
}
