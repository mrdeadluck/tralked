import Link from "next/link";
import type { CSSProperties } from "react";
import { titleFitStyle } from "@/components/game/title-fit";
import { Chip } from "@/components/ui/Chip";
import { PLATFORM_COLOR, type Platform } from "@/components/ui/PlatformChips";
import { Ring } from "@/components/ui/Ring";
import { genreName, orderedGenres } from "@/lib/engine/genres";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail, WalkExtras } from "@/lib/queries/games";
import { CompatSeal } from "./CompatSeal";
import { editionLabel, MagazineCover } from "./MagazineCover";

/*
 * Head of a walkthrough page: the magazine cover on the left, the game on the right (official
 * logo when the catalog has one, else its name), the platform and "Treina…" chips, the compat
 * seal, edition and sources, and the visitor's progress ring. The wide official art is behind.
 */

const isPlatform = (value: string): value is Platform => value in PLATFORM_COLOR;

/** Up to four names the guide was written from: its sources, then the ones its items cite. */
function sourceNames(guide: GuideDetail, walkthrough: Walkthrough): string[] {
  const cited = walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.flatMap((i) => i.sources.map((x) => x.name))));
  return [...new Set([...guide.sources.map((s) => s.title), ...cited])].slice(0, 4);
}

type GuideHeroProps = { guide: GuideDetail; walkthrough: Walkthrough; walk: WalkExtras };

export function GuideHero({ guide, walkthrough, walk }: GuideHeroProps) {
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
  const progress = game.progress;
  const pct = progress && game.achievementCount > 0 ? Math.round((progress.unlockedCount / game.achievementCount) * 100) : null;
  const [lead, ...rest] = game.name.trim().split(/\s+/);
  const sources = sourceNames(guide, walkthrough);

  return (
    <section className="wk-hero" aria-label={`Guia Tralked de ${game.name}`}>
      {game.heroUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wk-hero-bg" src={game.heroUrl} alt="" fetchPriority="high" />
      ) : null}
      <div className="wk-hero-in">
        <p className="wk-hero-top" aria-hidden="true">
          <span className="wk-lbl">Manual · Guia Tralked · Steam</span>
          <span className="wk-lbl">Tralked</span>
        </p>

        <MagazineCover
          game={{ name: game.name, coverUrl: game.coverUrl, steamAppId: walk.steamAppId }}
          edition={guide.edition}
          cover={walkthrough.cover}
          playthroughs={guide.facts.playthroughs}
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
            Roteiro em {phases} {phases === 1 ? "etapa" : "etapas"} {through}, cada conquista no ponto exato do
            caminho e todos os coletáveis em ordem.
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
          {guide.compat ? <CompatSeal compat={guide.compat} counts={walk.compatCounts} /> : null}
          <p className="wk-meta">
            <span>
              Edição {editionLabel(guide.edition)} · Equipe Tralked
              {sources.length > 0 ? ` · fontes: ${sources.join(", ")}` : null}
            </span>
            <Link href={`/jogos/${game.slug}`} aria-label={`Página do jogo: ${game.name}`}>
              Página do jogo →
            </Link>
          </p>
        </div>

        {pct !== null && progress ? (
          <div className="wk-ring">
            <Ring value={pct} size={104} />
            <small>
              {progress.unlockedCount} de {game.achievementCount}
            </small>
          </div>
        ) : null}
      </div>
    </section>
  );
}
