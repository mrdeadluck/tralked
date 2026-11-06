import type { CSSProperties } from "react";
import { PLATFORM_TOKEN } from "@/components/character/platforms";
import { CaseItem, CaseShelf } from "@/components/shelf/CaseShelf";
import { caseArt } from "@/lib/case-art";
import type { PlatformId } from "@/lib/engine/trophies";
import type { LibraryGame } from "@/lib/library/queries";
import { bestVersionPct, type LibraryVersion } from "@/lib/library/versions";
import { formatPlaytime } from "@/lib/profile/library-view";
import { bandPlatforms } from "@/lib/releases/platforms";

/*
 * The profile's "Jogos" as a grid of game cases (the catalog's CaseShelf): each game once, with
 * one badge per version the player has across the foot of the cover ("PS5 ✓²": the platinum or
 * 100%, in two regional lists; "PC 64%": the best list's progress).
 */

const CSS = `
.lcg-vs { z-index: 4; position: absolute; left: 6px; right: 6px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 3px; }
.lcg-vb { display: inline-flex; align-items: center; gap: 4px; height: 21px; padding: 0 6px; background: color-mix(in oklch, var(--bg) 86%, transparent); font-size: 11.5px; font-weight: 800; font-stretch: 80%; letter-spacing: .05em; line-height: 1; text-transform: uppercase; color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.lcg-vb::before { content: ""; width: 5px; height: 5px; flex: none; background: var(--c, var(--muted)); }
.lcg-ok { color: var(--acc); font-weight: 900; }
.lcg-vb sup { font-size: 9.5px; line-height: 0; margin-left: -2px; color: var(--acc); }
.lcg-pc { color: var(--text-2); font-weight: 700; }
`;

/** The band's platform families of the player's copies. */
const FAMILY: Record<PlatformId, string> = { steam: "PC", psn: "PLAYSTATION", xbox: "XBOX", retro: "RETRO" };

/** "PS5: platina em 2 listas regionais", "PC: 64%". */
export function versionSummary(v: LibraryVersion): string {
  const state = v.platinum ? "platina" : v.pct !== null ? `${v.pct}%` : "sem troféus conhecidos";
  return `${v.label}: ${state}${v.regions > 1 ? ` em ${v.regions} listas regionais` : ""}`;
}

function VersionBadge({ version }: { version: LibraryVersion }) {
  return (
    <span
      className="lcg-vb"
      style={{ "--c": PLATFORM_TOKEN[version.platform] } as CSSProperties}
      title={versionSummary(version)}
    >
      {version.label}
      {/* Collapsed by the flex box (its gap spaces it); keeps "PS5 ✓" readable as text. */}
      {version.platinum || version.pct !== null ? " " : null}
      {version.platinum ? (
        <span className="lcg-ok">✓</span>
      ) : version.pct !== null ? (
        <span className="lcg-pc">{version.pct}%</span>
      ) : null}
      {version.regions > 1 ? <sup>{version.regions}</sup> : null}
    </span>
  );
}

function GameCase({ game }: { game: LibraryGame }) {
  const n = game.versions.length;
  const hours = formatPlaytime(game.playtimeMin);
  return (
    <CaseItem
      href={`/jogos/${game.slug}`}
      slug={game.slug}
      name={game.name}
      art={caseArt({ coverUrl: game.coverUrl, steamAppId: game.steamAppId, portraitChecked: game.portraitChecked })}
      platforms={bandPlatforms(game.platforms.map((p) => FAMILY[p.platform]))}
      flag={game.completed ? "TRALKED!" : undefined}
      progress={bestVersionPct(game.versions)}
      overlay={
        n > 0 ? (
          <span className="lcg-vs" aria-hidden="true">
            {game.versions.map((v) => (
              <VersionBadge key={v.key} version={v} />
            ))}
          </span>
        ) : null
      }
    >
      <h3 className="cs-name">{game.name}</h3>
      {n > 0 ? <span className="sr-only">{`Versões: ${game.versions.map(versionSummary).join("; ")}.`}</span> : null}
      <span className="cs-meta">
        <span>
          {n === 1 ? "1 versão" : `${n} versões`}
          {game.playtimeMin > 0 ? (
            <>
              {" · "}
              <b>{hours}</b>
            </>
          ) : null}
        </span>
        {game.stub ? <span>detalhes em breve</span> : null}
      </span>
    </CaseItem>
  );
}

/** A page of the player's library as game cases with their version badges. */
export function LibraryCoverGrid({ games, label }: { games: LibraryGame[]; label?: string }) {
  return (
    <>
      <style href="tralked-library-grid" precedence="default">
        {CSS}
      </style>
      <CaseShelf label={label}>
        {games.map((game) => (
          <GameCase key={game.gameId} game={game} />
        ))}
      </CaseShelf>
    </>
  );
}
