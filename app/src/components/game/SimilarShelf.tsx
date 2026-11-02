import { GameArt } from "@/components/art/GameArt";
import type { SimilarGame } from "@/lib/queries/game-profile";
import { titleFitStyle } from "./title-fit";

/*
 * "Na mesma estante": games with the same skills, as small cases leaning on a shelf (they
 * straighten up on hover/focus). The real cover when there is one, generated art otherwise.
 */

const CSS = `
.gpe { display: grid; grid-auto-flow: column; grid-auto-columns: 150px; gap: 26px; overflow-x: auto; margin: 0; padding: 18px 6px 34px; list-style: none; perspective: 900px; scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; }
.gpe a { display: flex; flex-direction: column; gap: 10px; }
.gpe-box { position: relative; aspect-ratio: 1 / 1.38; border-radius: 2px 6px 6px 2px; overflow: hidden; transform: rotateY(-14deg); transform-origin: left center; transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s; box-shadow: -6px 0 0 #0d0e12, 0 20px 30px -10px rgba(0,0,0,.8); background: var(--surface); }
.gpe a:hover .gpe-box, .gpe a:focus-visible .gpe-box { transform: rotateY(-2deg) translateY(-6px); box-shadow: -3px 0 0 #0d0e12, 0 26px 36px -10px rgba(0,0,0,.9), 0 0 0 1px var(--acc); }
.gpe-top { position: absolute; top: 0; left: 0; right: 0; height: 12%; background: var(--bg); border-bottom: 2px solid var(--acc); }
.gpe-nm { position: absolute; bottom: 8%; left: 0; right: 0; text-align: center; font-weight: 900; font-stretch: 125%; font-size: min(13px, calc(134px / var(--longest, 1))); line-height: .95; text-transform: uppercase; padding: 0 8px; text-shadow: 0 2px 10px rgba(0,0,0,.8); overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpe small { font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--muted); }
.gpe small b { color: var(--acc); font-weight: 500; }
.gpe-empty { color: var(--muted); }
`;

export function SimilarShelf({ games, aside }: { games: SimilarGame[]; aside: string }) {
  return (
    <section className="gp-veil" aria-labelledby="gp-h-sim">
      <style href="tralked-game-shelf" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id="gp-h-sim">Na mesma estante</h2>
        <span className="gp-aside">{aside}</span>
      </div>
      {games.length === 0 ? (
        <p className="gpe-empty">Nenhum jogo parecido no catálogo ainda.</p>
      ) : (
        <ul className="gpe">
          {games.map((g) => (
            <li key={g.slug}>
              <a href={`/jogos/${g.slug}`}>
                <span className="gpe-box">
                  <GameArt seed={g.seed} hues={g.hues} imageUrl={g.coverUrl} figure width={300} height={414} />
                  {g.coverUrl ? null : <span className="gpe-top" />}
                  {/* A real cover already carries the title art: the name stays for screen readers. */}
                  <span className={g.coverUrl ? "sr-only" : "gpe-nm"} style={g.coverUrl ? undefined : titleFitStyle(g.name)}>
                    {g.name}
                  </span>
                </span>
                <small>
                  {g.genre} · <b>{g.match}% combina</b>
                </small>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
