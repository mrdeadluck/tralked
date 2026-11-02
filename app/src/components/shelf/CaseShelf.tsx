import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { CaseArtSource } from "@/lib/case-art";
import { artHues, hashSeed } from "@/lib/queries/news";
import { CaseCover } from "./CaseCover";

/*
 * The case shelf of the game page prototype ("Na mesma estante", preview/tralked-jogo.html) as a
 * catalog grid: each game is a small case leaning on a shelf plank, straightening up on
 * hover/focus. Used by /jogos and /lancamentos.
 */

const CSS = `
.cs { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 40px 26px; margin: 0; padding: 10px 14px 8px; list-style: none; }
.cs > li { position: relative; min-width: 0; container-type: inline-size; }
.cs > li::before { content: ""; position: absolute; left: -13px; right: -13px; top: calc(100cqw * 1.38 + 4px); height: 7px; background: linear-gradient(180deg, #23252c, #121317 45%, #0a0b0d); box-shadow: 0 10px 18px -6px rgba(0,0,0,.85); }
.cs a { position: relative; display: flex; flex-direction: column; gap: 22px; color: inherit; text-decoration: none; }
.cs-box { position: relative; display: block; aspect-ratio: 1 / 1.38; border-radius: 2px 6px 6px 2px; overflow: hidden; background: var(--surface); transform: perspective(900px) rotateY(-14deg); transform-origin: left center; transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s; box-shadow: -6px 0 0 #0d0e12, 0 20px 30px -10px rgba(0,0,0,.8); }
.cs a:hover .cs-box, .cs a:focus-visible .cs-box { transform: perspective(900px) rotateY(-2deg) translateY(-6px); box-shadow: -3px 0 0 #0d0e12, 0 26px 36px -10px rgba(0,0,0,.9), 0 0 0 1px var(--acc); }
.cs-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cs-blur { position: absolute; inset: -12%; width: 124%; height: 124%; object-fit: cover; filter: blur(14px) brightness(.55) saturate(1.2); }
.cs-wide { position: absolute; left: 0; right: 0; top: 50%; width: 100%; transform: translateY(-50%); box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.cs-top { position: absolute; top: 0; left: 0; right: 0; height: 12%; background: var(--bg); border-bottom: 2px solid var(--acc); }
.cs-nm { position: absolute; bottom: 8%; left: 0; right: 0; text-align: center; font-weight: 900; font-stretch: 125%; font-size: min(15px, calc(100cqw * .86 / var(--longest, 1))); line-height: .95; text-transform: uppercase; padding: 0 8px; text-shadow: 0 2px 10px rgba(0,0,0,.8); overflow-wrap: normal; word-break: normal; hyphens: manual; }
.cs-flag { position: absolute; top: 8px; right: 8px; background: var(--acc); color: var(--bg); padding: 3px 6px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.cs-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(0,0,0,.6); }
.cs-bar > span { display: block; height: 100%; width: var(--pct); background: var(--acc); }
.cs-cap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cs-name { margin: 0; font-size: 15px; line-height: 1.2; font-weight: 800; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.cs a:hover .cs-name, .cs a:focus-visible .cs-name { color: var(--acc); }
.cs-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--muted); }
.cs-meta b { color: var(--text); font-weight: 500; }
.cs-meta .acc { color: var(--acc); }
@media (prefers-reduced-motion: reduce) { .cs-box { transition: none; } .cs a:hover .cs-box, .cs a:focus-visible .cs-box { transform: perspective(900px) rotateY(-14deg); } }
`;

export function CaseShelf({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <>
      <style href="tralked-case-shelf" precedence="default">
        {CSS}
      </style>
      <ul className="cs" aria-label={label}>
        {children}
      </ul>
    </>
  );
}

type CaseItemProps = {
  href: string;
  slug: string;
  name: string;
  art: CaseArtSource[];
  /** Ribbon on the case ("PLATINADO"). */
  flag?: string;
  /** 0–100: the visitor's progress, as a bar at the foot of the case. */
  progress?: number | null;
  /** The caption under the case (name and details). */
  children: ReactNode;
};

export function CaseItem({ href, slug, name, art, flag, progress, children }: CaseItemProps) {
  return (
    <li>
      <Link href={href}>
        <span className="cs-box">
          <CaseCover name={name} art={art} seed={hashSeed(slug)} hues={artHues(slug, slug)} />
          {flag ? <span className="cs-flag">{flag}</span> : null}
          {progress != null ? (
            <span className="cs-bar" aria-hidden="true">
              <span style={{ "--pct": `${progress}%` } as CSSProperties} />
            </span>
          ) : null}
        </span>
        <span className="cs-cap">{children}</span>
      </Link>
    </li>
  );
}
