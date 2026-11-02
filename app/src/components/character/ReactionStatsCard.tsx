import { Card } from "@/components/ui/Card";
import type { ReactionStats } from "@/lib/community/reactions";
import { CardHead } from "./CardHead";

/**
 * "Reações" on the character sheet: likes received, likes and dislikes given. Only the counters
 * above zero show; a player with none gets no card at all.
 */
export function ReactionStatsCard({ stats }: { stats: ReactionStats }) {
  const rows = [
    { n: stats.likesReceived, one: "curtida recebida", many: "curtidas recebidas", accent: true },
    { n: stats.likesGiven, one: "curtida dada", many: "curtidas dadas", accent: false },
    { n: stats.dislikesGiven, one: "descurtida dada", many: "descurtidas dadas", accent: false },
  ].filter((r) => r.n > 0);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHead title="Reações" />
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pt-3.5">
        {rows.map((r) => (
          <li key={r.one} className="flex items-baseline gap-3">
            <b
              className={`min-w-[3ch] text-[22px] leading-none font-black font-stretch-[125%] tabular-nums ${
                r.accent ? "text-acc" : "text-text"
              }`}
            >
              {r.n.toLocaleString("pt-BR")}
            </b>
            <span className="text-sm text-muted">{r.n === 1 ? r.one : r.many}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
