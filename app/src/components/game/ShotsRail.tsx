import { GameArt, type Hues } from "@/components/art/GameArt";
import type { GameShot } from "@/lib/queries/game-profile";
import { Rail } from "./MediaRail";

/**
 * "Imagens oficiais": screenshots first, then artworks. A real image opens full size in a new
 * tab; rows without a file (seed fixtures) show the generated art, labelled as an illustration.
 */
export function ShotsRail({ shots, gameName, hues }: { shots: GameShot[]; gameName: string; hues: Hues }) {
  if (shots.length === 0) return null;
  return (
    <Rail headingId="gp-h-img" title="Imagens oficiais" variant="shots" label={`Imagens de ${gameName}`}>
      {shots.map((shot, i) =>
        shot.url ? (
          <div key={shot.id} role="listitem">
            <a
              className="gpr-tile gpr-s"
              href={shot.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${shot.label} (abre em nova aba)`}
            >
              <GameArt seed={shot.seed} hues={hues} imageUrl={shot.url} alt="" width={560} height={350} />
            </a>
          </div>
        ) : (
          <div key={shot.id} role="listitem" className="gpr-tile gpr-s">
            <GameArt seed={shot.seed} hues={i % 3 ? hues : [200, 230]} figure={i % 3 === 1} width={560} height={350} />
            <span className="sr-only">Ilustração {i + 1}</span>
          </div>
        ),
      )}
    </Rail>
  );
}
