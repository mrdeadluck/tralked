import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { TopPlayer } from "@/lib/queries/news";

/** 12400 -> "12k", 1_250_000 -> "1,3M" (preview fmtK). */
function formatXp(xp: number): string {
  if (xp >= 1_000_000) return `${(xp / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (xp >= 1_000) return `${Math.round(xp / 1_000)}k`;
  return String(xp);
}

/** Players must already be ordered by XP descending; bars are relative to #1. */
export function CommunityRanking({ players }: { players: TopPlayer[] }) {
  const top = players[0]?.totalXp ?? 0;
  return (
    <Card>
      <div className="mb-1 flex items-end justify-between gap-3 border-b border-[#23252c] pb-3.5">
        <h2 className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Ranking da
          <br />
          comunidade
        </h2>
        <Link
          href="/highscores"
          className="font-mono text-xs tracking-[0.08em] text-acc uppercase"
        >
          Ver tudo →
        </Link>
      </div>
      <ol className="m-0 list-none p-0">
        {players.map((player, index) => (
          <li
            key={player.handle}
            className="grid grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-divider py-3 last:border-b-0"
          >
            <span
              className={`text-xl font-black font-stretch-[125%] ${
                index === 0 ? "text-acc" : index < 3 ? "text-text" : "text-dim"
              }`}
            >
              {index + 1}
            </span>
            <span
              aria-hidden="true"
              className="size-10 rounded-full bg-[repeating-linear-gradient(135deg,#1c1e24_0_4px,#24262d_4px_8px)]"
            />
            <div className="min-w-0">
              <span className="mb-1.5 block truncate text-[15px] font-bold">
                @{player.handle}
              </span>
              <ProgressBar
                value={top > 0 ? Math.round((player.totalXp / top) * 100) : 0}
                label={`XP de @${player.handle} em relação ao primeiro colocado`}
              />
            </div>
            <div className="flex flex-col items-end gap-1 font-mono">
              <b className="text-[13px]">
                {formatXp(player.totalXp)}
                <small className="text-xs font-normal text-dim-2"> XP</small>
              </b>
              <span className="text-xs tracking-[0.06em] text-[#a3a6ae]">
                NV {player.level}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
