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
.gpm { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) 300px; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.gpm > * { background: var(--surface); }
.gpm[data-noshots] { grid-template-columns: minmax(0, 1fr) 300px; }
.gpm-shots { position: relative; display: grid; grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; min-height: 260px; padding: 0; background: var(--bg-deep, #08090b); }
.gpm-shots > :first-child { grid-row: span 2; }
.gpm-shot { position: relative; overflow: hidden; min-height: 0; }
.gpm-shot img, .gpm-shot svg, .gpm-shot canvas { display: block; width: 100%; height: 100%; object-fit: cover; }
.gpm-tag { position: absolute; left: 12px; bottom: 12px; z-index: 1; padding: 4px 8px; background: rgba(11,12,15,.82); border: 1px solid var(--border-2); font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-2); }
.gpm-body { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 26px 28px; }
.gpm-body h3 { font-weight: 900; font-stretch: 125%; font-size: 22px; line-height: 1.05; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
.gpm-body p { font-size: 15px; line-height: 1.55; color: var(--text-2); max-width: 46ch; }
.gpm-xp { display: inline-flex; align-items: baseline; gap: 6px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.gpm-xp b { font-family: inherit; font-size: 15px; color: var(--acc); letter-spacing: 0; }
.gpm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.gpm-side { padding: 0; display: flex; }
.gpm-side > .gp-side { flex: 1; border: 0; border-radius: 0; }
@media (max-width: 1100px) { .gpm { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .gpm-side { grid-column: 1 / -1; } }
@media (max-width: 700px) { .gpm, .gpm[data-noshots] { grid-template-columns: 1fr; } .gpm-shots { min-height: 200px; } .gpm-body { padding: 22px 20px; } }
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
          Conversar no fórum do jogo →
        </a>
      </div>
      <div className="gpm" data-noshots={three.length === 0 ? "" : undefined}>
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
            <a className="gp-btn gp-btn-acc" href={`/galeria?jogo=${slug}`}>
              Enviar a primeira foto
            </a>
            <a className="gp-btn" href={`/forum/${slug}`}>
              Abrir o fórum
            </a>
          </div>
        </div>
        <div className="gpm-side">{side}</div>
      </div>
    </section>
  );
}
