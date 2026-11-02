import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { hashSeed, type TopPlayer } from "@/lib/queries/news";
import { formatCompact, formatExact } from "@/lib/xp-format";

/** Below this many players the list ends with an invitation to take a place. */
const FULL = 5;

/** The player's Steam avatar, else a monogram on a hue of their own (stable per handle). */
function Avatar({ player, lead }: { player: TopPlayer; lead: boolean }) {
  const ring = lead ? "ring-2 ring-acc" : "ring-1 ring-line-2";
  if (player.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Steam avatar, external domain
      <img src={player.avatarUrl} alt="" width={40} height={40} loading="lazy" className={`size-10 rounded-full object-cover ${ring}`} />
    );
  }
  const hue = hashSeed(player.handle) % 360;
  return (
    <span
      aria-hidden="true"
      className={`grid size-10 place-items-center rounded-full text-[17px] font-black font-stretch-[125%] ${ring}`}
      style={{ background: `oklch(0.32 0.07 ${hue})`, color: `oklch(0.9 0.08 ${hue})` }}
    >
      {(player.displayName || player.handle).charAt(0).toUpperCase()}
    </span>
  );
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
        <Link href="/highscores" className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
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
            <Avatar player={player} lead={index === 0} />
            <div className="min-w-0">
              <Link href={`/jogador/${player.handle}`} className="mb-1.5 block truncate text-[15px] font-bold hover:text-acc">
                @{player.handle}
              </Link>
              <ProgressBar
                value={top > 0 ? Math.round((player.totalXp / top) * 100) : 0}
                label={`XP de @${player.handle} em relação ao primeiro colocado`}
              />
            </div>
            <div className="flex flex-col items-end gap-1 font-mono">
              <b className="text-[13px]" title={`${formatExact(player.totalXp)} XP`}>
                {formatCompact(player.totalXp)}
                <small className="text-xs font-normal text-dim-2"> XP</small>
              </b>
              <span className="text-xs tracking-[0.06em] text-[#a3a6ae]">NV {player.level}</span>
            </div>
          </li>
        ))}
        {players.length < FULL ? (
          <li className="border-t border-divider pt-3 first:border-t-0">
            <Link
              href="/conta/conexoes"
              className="group grid grid-cols-[28px_40px_minmax(0,1fr)] items-center gap-3 rounded-[3px] py-1"
            >
              <span className="text-xl font-black font-stretch-[125%] text-ph">{players.length + 1}</span>
              <span aria-hidden="true" className="grid size-10 place-items-center rounded-full border border-dashed border-acc/60 text-acc">
                <svg viewBox="0 0 16 16" className="size-4">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" fill="none" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-bold group-hover:text-acc">Seu lugar está aqui</span>
                <span className="text-[13px] text-muted">Conecte uma conta e entre no ranking.</span>
              </span>
            </Link>
          </li>
        ) : null}
      </ol>
    </Card>
  );
}
