import Link from "next/link";
import type { ReactNode } from "react";
import { GameArt } from "@/components/art/GameArt";
import type { ShowcaseShot } from "@/lib/community/showcase";

/*
 * The empty gallery and forum, as an invitation (the same build as the game page's
 * CommunityInvite): a mosaic of official images from the games people play most, what the first
 * post earns, and one clear way in. Nothing in it pretends to be a player's post: the mosaic is
 * labelled "Imagens oficiais" and each tile names its game.
 */

const CSS = `
.csh { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.csh > * { background: var(--surface); }
.csh-shots { position: relative; display: grid; grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; min-height: 280px; background: var(--bg-deep); }
.csh-shots[data-count="1"] { grid-template-columns: 1fr; }
.csh-shots[data-count="2"] { grid-template-rows: 1fr; }
.csh-shots > :first-child { grid-row: span 2; }
.csh-shots[data-count="2"] > :first-child { grid-row: auto; }
.csh-shot { position: relative; display: block; overflow: hidden; min-height: 0; }
.csh-shot img, .csh-shot svg, .csh-shot canvas { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 700ms cubic-bezier(.16,1,.3,1); }
.csh-shot:hover img, .csh-shot:hover canvas, .csh-shot:focus-visible img, .csh-shot:focus-visible canvas { transform: scale(1.04); }
.csh-shot::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 55%, rgb(8 9 11 / .85)); pointer-events: none; }
.csh-name { position: absolute; left: 10px; right: 10px; bottom: 9px; z-index: 1; font-size: 13px; font-weight: 700; line-height: 1.2; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csh-tag { position: absolute; left: 12px; top: 12px; z-index: 1; padding: 4px 8px; background: rgb(11 12 15 / .82); border: 1px solid var(--border-2); font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-2); }
.csh-body { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 28px 30px; }
.csh-body h2 { font-weight: 900; font-stretch: 125%; font-size: clamp(22px, 2.4vw, 28px); line-height: 1.02; letter-spacing: -0.025em; text-transform: uppercase; text-wrap: balance; }
.csh-body p { font-size: 15px; line-height: 1.55; color: var(--text-2); max-width: 46ch; }
.csh-xp { display: inline-flex; align-items: baseline; gap: 8px; padding: 8px 12px; border: 1px solid color-mix(in oklab, var(--acc) 40%, transparent); background: color-mix(in oklab, var(--acc) 7%, transparent); border-radius: 2px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
.csh-xp b { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: var(--acc); }
.csh-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 4px; }
@media (max-width: 760px) {
  .csh { grid-template-columns: 1fr; }
  .csh-shots { min-height: 200px; aspect-ratio: 16 / 9; }
  .csh-body { padding: 22px 20px; }
}
@media (prefers-reduced-motion: reduce) { .csh-shot img, .csh-shot canvas { transition: none; } }
`;

/**
 * The showcase's loading state, block for block (mosaic, heading, two lines of text per line of the
 * real copy, the XP chip, one button): what streams in takes exactly this room.
 */
export function CommunityShowcaseSkeleton() {
  const bar = "block animate-pulse rounded-[2px] bg-hover-2 motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex min-w-0 flex-col gap-6">
      <div className="csh">
        <style href="tralked-community-showcase" precedence="default">
          {CSS}
        </style>
        <div className="csh-shots" data-count={3}>
          <span className={`${bar} rounded-none`} />
          <span className={`${bar} rounded-none`} />
          <span className={`${bar} rounded-none`} />
        </div>
        <div className="csh-body">
          <span className={`${bar} h-[56px] w-[80%]`} />
          <span className="flex w-full flex-col gap-2">
            <span className={`${bar} h-[15px] w-full`} />
            <span className={`${bar} h-[15px] w-[92%]`} />
            <span className={`${bar} h-[15px] w-[70%]`} />
            <span className={`${bar} h-[15px] w-[40%] max-[760px]:block min-[761px]:hidden`} />
          </span>
          <span className={`${bar} h-[40px] w-[230px]`} />
          <span className={`${bar} mt-auto h-11 w-[220px]`} />
        </div>
      </div>
    </div>
  );
}

export const SHOWCASE_PRIMARY =
  "inline-flex h-11 items-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]";
export const SHOWCASE_GHOST =
  "inline-flex h-11 items-center rounded-[2px] border border-line-2 px-[18px] font-mono text-xs tracking-[0.1em] text-text uppercase hover:border-text";

export function CommunityShowcase({
  id,
  title,
  text,
  xp,
  xpNote,
  shots,
  shotHref,
  actions,
}: {
  /** Id of the heading (the section is labelled by it). */
  id: string;
  title: string;
  text: ReactNode;
  /** The promise, big: "+50 XP". */
  xp: string;
  /** What it is for: "por foto, até 3 por dia". */
  xpNote: string;
  shots: ShowcaseShot[];
  /** Where a tile leads (its game's gallery or forum). */
  shotHref: (slug: string) => string;
  /** The way in (one primary action, at most one secondary). */
  actions: ReactNode;
}) {
  const real = shots.some((s) => s.url);
  return (
    <section aria-labelledby={id} className="csh">
      <style href="tralked-community-showcase" precedence="default">
        {CSS}
      </style>
      {shots.length > 0 ? (
        <div className="csh-shots" data-count={shots.length}>
          {shots.map((shot, i) => (
            <Link key={shot.slug} href={shotHref(shot.slug)} className="csh-shot" aria-label={shot.name}>
              <GameArt
                seed={shot.seed}
                hues={shot.hues}
                imageUrl={shot.url}
                alt=""
                figure={!shot.url && i === 0}
                width={i === 0 ? 640 : 420}
                height={i === 0 ? 400 : 260}
                sizes={i === 0 ? "(max-width: 760px) 60vw, 380px" : "(max-width: 760px) 40vw, 260px"}
              />
              <span aria-hidden="true" className="csh-name">
                {shot.name}
              </span>
            </Link>
          ))}
          {real ? <span className="csh-tag">Imagens oficiais</span> : null}
        </div>
      ) : null}
      <div className="csh-body">
        <h2 id={id}>{title}</h2>
        <p>{text}</p>
        <span className="csh-xp">
          <b>{xp}</b> {xpNote}
        </span>
        <div className="csh-actions">{actions}</div>
      </div>
    </section>
  );
}
