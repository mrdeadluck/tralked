import Link from "next/link";
import type { CSSProperties } from "react";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { PLATFORM_LABEL } from "@/components/character/platforms";
import type { ProfileAchievement } from "@/lib/profile/queries";
import { formatDate, formatGlobalPct } from "./format";

/*
 * "Mais raras" as a trophy case: the rarest trophy stands alone on its plinth, lit by its game's
 * art; the next five line the shelf beside it, rarest first. Colors are the rarity tokens.
 */

const CSS = `
.rsc { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 0; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; background: var(--surface); }
@media (max-width: 760px) { .rsc { grid-template-columns: 1fr; } }
.rsc-star { position: relative; isolation: isolate; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 14px; padding: 36px 24px 26px; min-height: 340px; text-align: center; overflow: hidden; }
.rsc-bg { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; opacity: .32; filter: saturate(.85); }
.rsc-star::before { content: ""; position: absolute; inset: 0; z-index: -1; background: radial-gradient(60% 55% at 50% 38%, color-mix(in oklab, var(--tier) 22%, transparent), transparent 70%), linear-gradient(180deg, rgba(11,12,15,.35), rgba(11,12,15,.92) 78%); }
.rsc-icon { position: relative; width: 112px; height: 112px; border-radius: 6px; border: 2px solid var(--tier); object-fit: cover; background: var(--bg); box-shadow: 0 18px 30px -12px rgba(0,0,0,.9); }
.rsc-plinth { width: 168px; height: 9px; margin-top: -6px; background: linear-gradient(180deg, #2a2c33, #121317 45%, #0a0b0d); box-shadow: 0 12px 20px -6px rgba(0,0,0,.9); border-radius: 1px; }
.rsc-pct { font-weight: 900; font-stretch: 125%; font-size: clamp(40px, 5vw, 56px); line-height: .9; letter-spacing: -0.03em; color: var(--tier); font-variant-numeric: tabular-nums; }
.rsc-shelf { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); }
@media (max-width: 760px) { .rsc-shelf { border-left: 0; border-top: 1px solid var(--border); } }
.rsc-shelf > li { flex: 1; display: grid; grid-template-columns: 22px 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--divider); }
.rsc-shelf > li:last-child { border-bottom: 0; }
.rsc-shelf img, .rsc-ph { width: 48px; height: 48px; border-radius: 3px; border: 1px solid var(--tier); object-fit: cover; }
.rsc-ph { display: grid; place-items: center; background: var(--stripes); }
.rsc-icon.rsc-ph { width: 112px; height: 112px; border-radius: 6px; border-width: 2px; }
.rsc-icon.rsc-ph svg { width: 48px; height: 48px; }
`;

const tier = (a: ProfileAchievement) => ({ "--tier": RARITY_COLOR[a.rarity] }) as CSSProperties;
const pct = (a: ProfileAchievement) => (a.globalPct !== null ? formatGlobalPct(a.globalPct) : "—");

function TrophyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 text-[var(--tier)]">
      <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function RareShowcase({ achievements, backdrop }: { achievements: ProfileAchievement[]; backdrop: string | null }) {
  const [star, ...shelf] = achievements;
  if (!star) return null;
  return (
    <div className="rsc">
      <style href="tralked-rare-showcase" precedence="default">
        {CSS}
      </style>
      <div className="rsc-star" style={tier(star)}>
        {backdrop ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked game art, as GameArt
          <img className="rsc-bg" src={backdrop} alt="" loading="lazy" decoding="async" />
        ) : null}
        {star.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- platform icon hosts are external
          <img className="rsc-icon" src={star.iconUrl} alt="" width={112} height={112} />
        ) : (
          <span className="rsc-icon rsc-ph" aria-hidden="true">
            <TrophyGlyph />
          </span>
        )}
        <span className="rsc-plinth" aria-hidden="true" />
        <p className="rsc-pct">{pct(star)}</p>
        <p className="font-mono text-xs tracking-[0.06em] text-text-2 uppercase">
          dos jogadores a desbloquearam · <b className="font-bold text-[var(--tier)]">{RARITY_LABEL[star.rarity]}</b>
        </p>
        <div className="flex max-w-[42ch] flex-col gap-1">
          <h3 className="text-[20px] leading-tight font-extrabold text-balance">{star.name}</h3>
          {star.description ? <p className="text-sm text-text-2">{star.description}</p> : null}
          <p className="mt-1 font-mono text-xs text-muted">
            <Link href={`/jogos/${star.game.slug}`} className="font-sans text-[13px] font-semibold text-text hover:text-acc">
              {star.game.name}
            </Link>{" "}
            · {PLATFORM_LABEL[star.platform]} · <time dateTime={star.unlockedAt.toISOString()}>{formatDate(star.unlockedAt)}</time>
          </p>
        </div>
      </div>
      {shelf.length > 0 ? (
        <ol className="rsc-shelf" start={2}>
          {shelf.map((a, i) => (
            <li key={a.id} style={tier(a)}>
              <span className="font-mono text-xs text-dim tabular-nums" aria-hidden="true">
                {i + 2}
              </span>
              {a.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- platform icon hosts are external
                <img src={a.iconUrl} alt="" width={48} height={48} loading="lazy" />
              ) : (
                <span className="rsc-ph" aria-hidden="true">
                  <TrophyGlyph />
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-extrabold" title={a.name}>
                  {a.name}
                </span>
                <Link href={`/jogos/${a.game.slug}`} className="truncate text-[13px] text-text-3 hover:text-acc">
                  {a.game.name}
                </Link>
              </span>
              <span className="text-right">
                <b className="block text-[20px] leading-none font-black font-stretch-[112%] tabular-nums" style={{ color: "var(--tier)" }}>
                  {pct(a)}
                </b>
                <span className="font-mono text-xs text-muted">{RARITY_LABEL[a.rarity]}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
