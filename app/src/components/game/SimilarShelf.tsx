import { CoverArt } from "@/components/art/CoverArt";
import { caseArt } from "@/lib/case-art";
import type { SimilarGame } from "@/lib/queries/game-profile";

/*
 * "Na mesma estante": games with the same skills, as straight cases in a row (they lift on
 * hover/focus), each with its title underneath. The cover goes through the
 * shared fallback chain (stored cover, Steam's portrait art, wide art printed as a case, generated art
 * with the name), so a case is never a generic picture without a name.
 */

const CSS = `
.gpe { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
.gpe a { display: flex; flex-direction: column; gap: 6px; }
.gpe-box { position: relative; display: block; overflow: hidden; background: var(--surface); box-shadow: 0 10px 18px -8px rgba(0,0,0,.8); transition: transform .2s, box-shadow .2s; }
.gpe-box::after { content: ""; position: absolute; inset: 0; box-shadow: inset 6px 0 0 rgba(0,0,0,.35); pointer-events: none; }
.gpe a:hover .gpe-box, .gpe a:focus-visible .gpe-box { transform: translateY(-4px); box-shadow: 0 14px 22px -8px rgba(0,0,0,.9), 0 0 0 1px var(--acc); }
.gpe-cap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gpe-name { font-size: 13.5px; line-height: 1.2; font-weight: 750; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.gpe a:hover .gpe-name, .gpe a:focus-visible .gpe-name { color: var(--acc); }
/* Genre and match side by side, or on two lines when narrow: no separator left dangling. */
.gpe small { display: flex; flex-wrap: wrap; gap: 0 6px; font-size: 12px; color: var(--muted); }
.gpe small b { color: var(--acc); font-weight: 700; white-space: nowrap; }
.gpe-empty { color: var(--muted); }
@media (max-width: 1100px) { .gpe { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 480px) { .gpe { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .gpe-box { transition: none; } .gpe a:hover .gpe-box, .gpe a:focus-visible .gpe-box { transform: none; } }
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
                    {g.genre ? <span>{g.genre}</span> : null}
                    <b>{g.match}% combina</b>
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
