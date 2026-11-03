import Link from "next/link";
import type { CSSProperties } from "react";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { PLATFORM_LABEL } from "@/components/character/platforms";
import type { ProfileAchievement } from "@/lib/profile/queries";
import { formatDate, formatGlobalPct } from "./format";

/*
 * "Mais raras" as a showcase of tiles, rarest first: the trophy's icon, its name and game, and the
 * share of players who unlocked it in the rarity's color. Moss ground: these are earned.
 */

type RareShowcaseProps = {
  achievements: ProfileAchievement[];
  /** Kept for callers of the former trophy-case layout; the tiles do not use a backdrop. */
  backdrop?: string | null;
};

const pct = (a: ProfileAchievement) => (a.globalPct !== null ? formatGlobalPct(a.globalPct) : "—");

function TrophyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 text-(--rc)">
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function RareShowcase({ achievements }: RareShowcaseProps) {
  if (achievements.length === 0) return null;
  return (
    <div className="@container">
    <ol className="m-0 grid list-none gap-2 p-0 @min-[520px]:grid-cols-2 @min-[780px]:grid-cols-3">
      {achievements.map((a) => (
        <li
          key={a.id}
          style={{ "--rc": RARITY_COLOR[a.rarity] } as CSSProperties}
          className="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3 bg-[linear-gradient(90deg,var(--moss-2),var(--surface-2)_70%)] p-2.5 shadow-[inset_3px_0_0_var(--rc)]"
          title={a.description ?? undefined}
        >
          {a.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- platform icon hosts are external
            <img src={a.iconUrl} alt="" width={52} height={52} loading="lazy" className="size-[52px] bg-track object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-[52px] place-items-center bg-track">
              <TrophyGlyph />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <strong className="text-[14.5px] leading-tight font-bold">{a.name}</strong>
            {a.description ? <span className="mt-0.5 line-clamp-2 text-xs text-muted">{a.description}</span> : null}
            <small className="mt-0.5 text-[12.5px] text-muted">
              <Link href={`/jogos/${a.game.slug}`} className="text-text-2 hover:text-acc hover:underline">
                {a.game.name}
              </Link>{" "}
              · {PLATFORM_LABEL[a.platform]} · <time dateTime={a.unlockedAt.toISOString()}>{formatDate(a.unlockedAt)}</time>
            </small>
            <span className="mt-1 flex items-baseline gap-1.5 text-[12.5px]">
              <b className="font-extrabold text-text tabular-nums">{pct(a)}</b>
              <span className="font-bold font-stretch-[75%] tracking-[0.06em] text-(--rc) uppercase">
                {RARITY_LABEL[a.rarity]}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ol>
    </div>
  );
}
