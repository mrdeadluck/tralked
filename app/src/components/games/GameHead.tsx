import Link from "next/link";
import type { CSSProperties } from "react";
import { GameArt } from "@/components/art/GameArt";
import { titleFitStyle } from "@/components/game/title-fit";
import { timeAgo } from "@/components/guide/format";
import { Chip } from "@/components/ui/Chip";
import { PLATFORM_COLOR, type Platform } from "@/components/ui/PlatformChips";
import { Ring } from "@/components/ui/Ring";
import { orderedGenres, genreName } from "@/lib/engine/genres";
import type { GameDetail } from "@/lib/queries/games";
import { GameCover } from "./GameCover";

/*
 * Head of the guide page, drawn as the cover of the case's booklet (the "Manual" the case intro
 * shows on the game page): paper with the game's art bleeding in, "Manual" printed at the top,
 * the title set low like the booklet's, and a folio at the foot. The game's cover sits on the
 * left as on a printed manual; the visitor's progress ring stays on the right.
 */

const CSS = `
.gh { position: relative; display: grid; grid-template-columns: 200px minmax(0, 1fr) auto; gap: 36px; align-items: end; min-height: 320px; padding: 68px 40px 52px; border-radius: 4px; overflow: hidden; background: var(--paper); box-shadow: 0 40px 90px -40px rgba(0,0,0,.9), inset 0 0 0 1px var(--border); }
.gh::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(255,255,255,.012) 0 1px, transparent 1px 3px), linear-gradient(90deg, var(--paper) 18%, rgba(21,22,27,.72) 55%, rgba(21,22,27,.25)), linear-gradient(0deg, var(--paper) 0%, transparent 55%); }
.gh::after { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; z-index: 2; background: var(--acc); }
.gh-art { position: absolute; inset: 0; opacity: .5; }
.gh-art img, .gh-art canvas { object-position: center 30%; }
.gh > :not(.gh-art) { position: relative; z-index: 2; }
.gh-mast { position: absolute !important; top: 22px; left: 40px; right: 40px; display: flex; justify-content: space-between; gap: 16px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .22em; text-transform: uppercase; color: var(--text-2); }
.gh-mast b { font-weight: 700; color: var(--text); }
.gh-cover { align-self: end; transform: rotate(-2deg); box-shadow: 0 24px 40px -14px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; }
.gh-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; container-type: inline-size; }
.gh-title { font-weight: 900; font-stretch: 125%; font-size: min(clamp(36px, 5.2vw, 76px), calc(100cqi / var(--longest, 1))); line-height: .88; letter-spacing: -0.04em; text-transform: uppercase; text-wrap: balance; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gh-lede { font-size: 17px; line-height: 1.5; color: var(--text-2); max-width: 60ch; }
.gh-tags { display: flex; flex-wrap: wrap; gap: 6px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
.gh-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--dim); }
.gh-meta .gh-by { color: var(--text-2); }
.gh-human { display: inline-flex; align-items: center; gap: 6px; color: var(--acc); }
.gh-human::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--acc); }
.gh-link { display: inline-flex; align-items: center; min-height: 24px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); text-underline-offset: 3px; }
.gh-link:hover { text-decoration: underline; }
.gh-folio { position: absolute !important; bottom: 16px; right: 40px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .14em; color: var(--dim); }
@media (max-width: 900px) {
  .gh { grid-template-columns: 120px minmax(0, 1fr); gap: 22px; padding: 64px 24px 48px; min-height: 0; align-items: start; }
  .gh-mast { left: 24px; right: 24px; }
  .gh-ring { grid-column: 1 / -1; }
  .gh-folio { right: 24px; }
}
@media (max-width: 560px) {
  .gh { grid-template-columns: 1fr; }
  .gh-cover { width: 112px; }
  .gh-mast-sub { display: none; }
}
`;

function isPlatform(value: string): value is Platform {
  return value in PLATFORM_COLOR;
}

export function GameHead({ game }: { game: GameDetail }) {
  const { progress, guide } = game;
  const pct =
    progress && game.achievementCount > 0
      ? Math.round((progress.unlockedCount / game.achievementCount) * 100)
      : null;
  const genres = orderedGenres(game.skills);

  return (
    <>
      <style href="tralked-guide-head" precedence="default">
        {CSS}
      </style>
      {/* Plan 4 F12: Jogos › <Jogo> › Guia. */}
      <nav aria-label="Você está em" className="mb-[18px] font-mono text-xs tracking-[0.1em] text-dim uppercase">
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0">
          <li>
            <Link href="/jogos" className="hover:text-acc">
              Jogos
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="min-w-0">
            <Link href={`/jogos/${game.slug}`} className="hover:text-acc">
              {game.name}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <span aria-current="page" className="text-text-2">
              {guide ? "Guia" : "Jogo"}
            </span>
          </li>
        </ol>
      </nav>
      <header className="gh">
        <div className="gh-art" aria-hidden="true">
          <GameArt seed={game.name.length * 7919} imageUrl={game.heroUrl ?? game.coverUrl} figure width={1200} height={420} />
        </div>
        <p className="gh-mast" aria-hidden="true">
          <span>
            <b>Manual</b>
            <span className="gh-mast-sub"> · Guia de conquistas 100%</span>
          </span>
          <span>Tralked</span>
        </p>
        <div className="gh-cover">
          <GameCover name={game.name} coverUrl={game.coverUrl} wideUrl={game.heroUrl} ratio="3 / 4" alt="" className="" />
        </div>
        <div className="gh-main">
          <h1 className="gh-title" style={titleFitStyle(game.name) as CSSProperties}>
            {game.name}
          </h1>
          {guide ? (
            <p className="gh-lede">
              Rota em {guide.stepCount} {guide.stepCount === 1 ? "etapa" : "etapas"}, cada conquista explicada e os
              coletáveis do jogo.
            </p>
          ) : null}
          <div className="gh-tags">
            {game.platforms.filter(isPlatform).map((platform) => (
              <Chip key={platform} color={PLATFORM_COLOR[platform]}>
                {platform}
              </Chip>
            ))}
            {genres.map((skill) => (
              <Chip key={skill} plain>
                Treina {genreName(skill)}
              </Chip>
            ))}
          </div>
          {guide ? (
            <div className="gh-meta">
              {guide.authorHandle ? <span className="gh-by">por @{guide.authorHandle}</span> : null}
              <span>atualizado {timeAgo(guide.updatedAt, game.generatedAt)}</span>
              <span>{guide.version}</span>
              {guide.reviewers.length > 0 ? (
                <span>revisado por {guide.reviewers.map((h) => `@${h}`).join(", ")}</span>
              ) : null}
              <span className="gh-human">Autoria humana</span>
              <Link href={`/jogos/${game.slug}`} aria-label={`Página do jogo: ${game.name}`} className="gh-link">
                Página do jogo →
              </Link>
            </div>
          ) : null}
        </div>
        {pct !== null ? (
          <div className="gh-ring">
            <Ring value={pct} size={120} />
          </div>
        ) : null}
        <span className="gh-folio" aria-hidden="true">
          00 · Manual
        </span>
      </header>
    </>
  );
}
