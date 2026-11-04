import Link from "next/link";
import type { CSSProperties } from "react";
import { titleFitStyle } from "@/components/game/title-fit";
import { Chip } from "@/components/ui/Chip";
import { PLATFORM_COLOR, type Platform } from "@/components/ui/PlatformChips";
import { genreName, orderedGenres } from "@/lib/engine/genres";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail, WalkExtras } from "@/lib/queries/games";
import { CompatSeal, PsnListSeal } from "./CompatSeal";
import { editionLabel, MagazineCover } from "./MagazineCover";
import { ProgressRing } from "./ProgressBits";
import { ResumeButton } from "./ResumeButton";
import { VersionSwitch } from "./version-state";
import { Both } from "./versions";

/*
 * Head of a walkthrough page: the magazine cover on the left, the game on the right (official
 * logo when the catalog has one, else its name), the platform and "Treina…" chips, the compat
 * seal (with "Steam | PlayStation" beside it when the guide has both versions), edition and
 * sources, "Continuar de onde parou" and the visitor's progress ring (streamed in, see progress.tsx).
 * The wide official art is behind.
 */

const isPlatform = (value: string): value is Platform => value in PLATFORM_COLOR;

/** Up to four names the guide was written from: its sources, then the ones its items cite. */
function sourceNames(guide: GuideDetail, walkthrough: Walkthrough): string[] {
  const cited = walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.flatMap((i) => i.sources.map((x) => x.name))));
  return [...new Set([...guide.sources.map((s) => s.title), ...cited])].slice(0, 4);
}

type GuideHeroProps = {
  guide: GuideDetail;
  walkthrough: Walkthrough;
  walk: WalkExtras;
  /** The guide reads as Steam or PlayStation (versions.tsx). */
  versions?: boolean;
};

export function GuideHero({ guide, walkthrough, walk, versions = false }: GuideHeroProps) {
  const { game } = guide;
  const chapters = walkthrough.chapters.length;
  const byRegion = walkthrough.chapters.every((c) => c.region);
  const through = byRegion
    ? chapters === 1
      ? "por 1 região"
      : `pelas ${chapters} regiões`
    : chapters === 1
      ? "por 1 capítulo"
      : `pelos ${chapters} capítulos`;
  const phases = guide.steps.length;
  const [lead, ...rest] = game.name.trim().split(/\s+/);
  const sources = sourceNames(guide, walkthrough);
  const psnList = walkthrough.scope === "psn" ? walkthrough.psnList : undefined;

  return (
    <section className="wk-hero" aria-label={`Guia Tralked de ${game.name}`}>
      {game.heroUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wk-hero-bg" src={game.heroUrl} alt="" fetchPriority="high" />
      ) : null}
      <div className="wk-hero-in">
        <p className="wk-hero-top" aria-hidden="true">
          <span className="wk-lbl">
            Manual · Guia Tralked · <Both steam="Steam" ps={versions ? "PlayStation" : undefined} />
          </span>
          <span className="wk-lbl">Tralked</span>
        </p>

        <MagazineCover
          game={{ name: game.name, coverUrl: game.coverUrl, steamAppId: walk.steamAppId }}
          edition={guide.edition}
          cover={walkthrough.cover}
          playthroughs={guide.facts.playthroughs}
          hours={walk.hours}
          date={game.guide.updatedAt}
        />

        <div className="wk-main">
          {walk.logoUrl ? (
            <h1>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wk-logo" src={walk.logoUrl} alt={game.name} />
            </h1>
          ) : (
            <h1 className="wk-gname" style={titleFitStyle(game.name) as CSSProperties}>
              {rest.length > 0 ? (
                <>
                  {lead} <span>{rest.join(" ")}</span>
                </>
              ) : (
                lead
              )}
            </h1>
          )}
          <p className="wk-sub">
            Roteiro em {phases} {phases === 1 ? "etapa" : "etapas"} {through}, cada{" "}
            {psnList ? "conquista da lista da PSN" : "conquista"} no ponto exato do caminho e todos os coletáveis em
            ordem.
          </p>
          <div className="wk-chips">
            {game.platforms.filter(isPlatform).map((platform) => (
              <Chip key={platform} color={PLATFORM_COLOR[platform]}>
                {platform}
              </Chip>
            ))}
            {orderedGenres(game.skills).map((skill) => (
              <Chip key={skill} plain>
                Treina {genreName(skill)}
              </Chip>
            ))}
          </div>
          {psnList ? (
            <PsnListSeal trophies={psnList.total} steamOnly={walkthrough.steamOnly?.length ?? 0} />
          ) : versions && guide.compat ? (
            <div className="wk-compat-row">
              <CompatSeal compat={guide.compat} counts={walk.compatCounts} />
              <VersionSwitch />
            </div>
          ) : guide.compat ? (
            <CompatSeal compat={guide.compat} counts={walk.compatCounts} />
          ) : null}
          <p className="wk-meta">
            <span>
              Edição {editionLabel(guide.edition)} · Equipe Tralked
              {sources.length > 0 ? ` · fontes: ${sources.join(", ")}` : null}
            </span>
            <Link href={`/jogos/${game.slug}`} aria-label={`Página do jogo: ${game.name}`}>
              Página do jogo →
            </Link>
          </p>
          <ResumeButton />
        </div>

        <ProgressRing achievementCount={game.achievementCount} />
      </div>
    </section>
  );
}
