import { CoverArt } from "@/components/art/CoverArt";
import { caseArt } from "@/lib/case-art";
import type { SimilarGame } from "@/lib/queries/game-profile";

/*
 * "Na mesma estante": games with the same skills, as small cases leaning on a shelf (they
 * straighten up on hover/focus), each with its title underneath. The cover goes through the
 * shared fallback chain (stored cover, Steam's portrait art, wide art shown whole, generated art
 * with the name), so a case is never a generic picture without a name.
 */

const CSS = `
.gpe { display: grid; grid-auto-flow: column; grid-auto-columns: 150px; gap: 26px; overflow-x: auto; margin: 0; padding: 18px 6px 34px; list-style: none; perspective: 900px; scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; }
.gpe a { display: flex; flex-direction: column; gap: 12px; }
.gpe-box { position: relative; display: block; border-radius: 2px 6px 6px 2px; overflow: hidden; transform: rotateY(-14deg); transform-origin: left center; transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s; box-shadow: -6px 0 0 #0d0e12, 0 20px 30px -10px rgba(0,0,0,.8); background: var(--surface); }
.gpe a:hover .gpe-box, .gpe a:focus-visible .gpe-box { transform: rotateY(-2deg) translateY(-6px); box-shadow: -3px 0 0 #0d0e12, 0 26px 36px -10px rgba(0,0,0,.9), 0 0 0 1px var(--acc); }
.gpe-cap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.gpe-name { font-size: 14.5px; line-height: 1.2; font-weight: 800; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.gpe a:hover .gpe-name, .gpe a:focus-visible .gpe-name { color: var(--acc); }
.gpe small { font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--muted); }
.gpe small b { color: var(--acc); font-weight: 500; white-space: nowrap; }
.gpe-empty { color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .gpe-box { transition: none; } .gpe a:hover .gpe-box, .gpe a:focus-visible .gpe-box { transform: rotateY(-14deg); } }
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
                  <CoverArt
                    name={g.name}
                    sources={caseArt({ coverUrl: g.coverUrl, steamAppId: g.steamAppId, wideUrl: g.heroUrl })}
                    ratio="1 / 1.38"
                    seed={g.seed}
                    hues={g.hues}
                    alt=""
                    width={150}
                    sizes="150px"
                  />
                </span>
                <span className="gpe-cap">
                  <span className="gpe-name">{g.name}</span>
                  <small>
                    {g.genre} · <b>{g.match}% combina</b>
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
