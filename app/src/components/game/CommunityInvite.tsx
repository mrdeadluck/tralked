import type { ReactNode } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { PHOTO_XP } from "@/lib/community/rewards";
import type { GameShot } from "@/lib/queries/game-profile";

/*
 * "Comunidade de <jogo>": one invitation in place of the stacked empty states (no news, dashed
 * photo frames, "0 fotos"). While players have not sent photos, the game's official images hold
 * the gallery's place, labelled as such; the card says what a first photo earns and where the
 * talk happens. `side` is the family card (a per-visitor island).
 */

const CSS = `
.gpm { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
.gpm-main { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: center; padding: 14px; background: var(--surface); }
.gpm[data-noshots] .gpm-main { grid-template-columns: 1fr; }
.gpm-shots { position: relative; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; aspect-ratio: 1; }
.gpm-shots > :first-child { grid-row: span 2; }
.gpm-shot { position: relative; overflow: hidden; min-height: 0; }
.gpm-shot img, .gpm-shot svg, .gpm-shot canvas { display: block; width: 100%; height: 100%; object-fit: cover; }
.gpm-tag { position: absolute; left: 8px; bottom: 8px; z-index: 1; padding: 3px 6px; background: rgba(15,17,21,.85); font-stretch: 75%; font-weight: 750; font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); }
.gpm-body { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.gpm-body h3 { font-weight: 900; font-stretch: 105%; font-size: 21px; line-height: 1.1; text-transform: uppercase; text-wrap: balance; }
.gpm-body p { font-size: 14px; line-height: 1.5; color: var(--text-2); max-width: 56ch; }
.gpm-xp { font-size: 13px; color: var(--muted); }
.gpm-xp b { color: var(--acc); font-weight: 800; }
.gpm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.gpm-side { display: flex; }
.gpm-side > .gp-side { flex: 1; }
@media (max-width: 1000px) { .gpm { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .gpm-main { grid-template-columns: 1fr; } .gpm-shots { aspect-ratio: 16 / 9; } }
`;

export function CommunityInvite({
  name,
  slug,
  shots,
  hues,
  withNews,
  side,
}: {
  name: string;
  slug: string;
  /** Official images (the first three with a file; generated art for seed fixtures). */
  shots: GameShot[];
  hues: Hues;
  /** The game already has its own news section above: the card only talks about photos. */
  withNews: boolean;
  side: ReactNode;
}) {
  const real = shots.filter((s) => s.url);
  // From the end of the list: the "Imagens oficiais" rail above starts with the first ones.
  const three = (real.length > 0 ? real : shots).slice(-3).reverse();
  return (
    <section className="gp-veil" aria-labelledby="gp-h-comm">
      <style href="tralked-game-community" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id="gp-h-comm">Comunidade de {name}</h2>
        <a className="gp-aside" href={`/forum/${slug}`}>
          Conversar no fórum do jogo
        </a>
      </div>
      <div className="gpm" data-noshots={three.length === 0 ? "" : undefined}>
        <div className="gpm-main">
        {three.length > 0 ? (
          <div className="gpm-shots">
            {three.map((shot, i) => (
              <div key={shot.id} className="gpm-shot">
                <GameArt seed={shot.seed} hues={hues} imageUrl={shot.url} alt="" figure={!shot.url && i === 0} width={560} height={350} sizes="320px" />
              </div>
            ))}
            <span className="gpm-tag">Imagens oficiais</span>
          </div>
        ) : null}
        <div className="gpm-body">
          <h3>A galeria de {name} ainda está vazia</h3>
          <p>
            {withNews
              ? `Envie a primeira captura de ${name}: ela aparece aqui, no seu perfil e na galeria do Tralked.`
              : `Ninguém postou fotos nem notícias de ${name} ainda. Envie a primeira captura, ou abra a conversa no fórum do jogo: o que você postar aparece aqui e no seu perfil.`}
          </p>
          <span className="gpm-xp">
            Cada foto rende <b>+{PHOTO_XP} XP</b>
          </span>
          <div className="gpm-actions">
            <a className="gp-btn gp-btn-acc tk-cut-b" href={`/galeria?jogo=${slug}`}>
              Enviar a primeira foto
            </a>
            <a className="gp-btn" href={`/forum/${slug}`}>
              Abrir o fórum
            </a>
          </div>
        </div>
        </div>
        <div className="gpm-side">{side}</div>
      </div>
    </section>
  );
}
