import { titleBoxFit } from "@/components/game/title-fit";
import { GameCover } from "@/components/games/GameCover";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";

/*
 * The magazine cover of a walkthrough: "TRALKED · Guias · Edição #N" over the game's official
 * portrait art. Everything stays legible by construction:
 * - the TRALKED logo is SVG text stretched to the full width (textLength), so it is never cut;
 * - masthead, calls + seal, and the foot are laid out in one column (no absolute positions), and
 *   the headline's size is fitted to its area, so it never runs over the calls.
 */

/** Width / height of the cover (US letter, like a printed magazine). */
const RATIO = 8.5 / 11;

/** Largest headline size (cqw) and the share of the cover's height it may take. */
const HEAD_MAX = 8.6;
const HEAD_AREA = 0.17;

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "#001": the edition, or "Prévia" before the guide is published. */
export function editionLabel(edition: number | null): string {
  return edition === null ? "Prévia" : `#${String(edition).padStart(3, "0")}`;
}

/** A seal of zero hours ("0 h", "0"): the guide has no estimate, so the seal shows a dash. */
const NO_HOURS = /^\s*0+(?:[.,]0+)?\s*(?:h|horas?)?\s*$/i;

/** The seal's hours as the robot wrote them, or "—" when there is no estimate (never "0 h"). */
function sealHoursText(sealHours: string, hours: { min: number; max: number }): string {
  if ((hours.min <= 0 && hours.max <= 0) || NO_HOURS.test(sealHours)) return "—";
  return sealHours;
}

/** The game's name split for the cover: all but the last word, and the last word (in lime). */
function splitName(name: string): [string, string] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return ["", name];
  return [words.slice(0, -1).join(" "), words[words.length - 1]];
}

type MagazineCoverProps = {
  game: { name: string; coverUrl: string | null; steamAppId: number | null };
  edition: number | null;
  cover: Walkthrough["cover"];
  /** Minimum playthroughs ("1"), printed on the seal. */
  playthroughs: string;
  /** The guide's hours (facts): 0/0 means no estimate. */
  hours: { min: number; max: number };
  /** Publication date of the edition. */
  date: Date;
};

export function MagazineCover({ game, edition, cover, playthroughs, hours, date }: MagazineCoverProps) {
  const [lead, last] = splitName(game.name);
  const headSize = Math.min(
    HEAD_MAX,
    titleBoxFit(game.name, { ratio: 1 / RATIO, widthFrac: 0.9, heightFrac: HEAD_AREA, lineHeight: 0.9 }),
  );
  const runs = playthroughs.trim() === "1" ? "1 zerada" : `${playthroughs} zeradas`;

  return (
    <figure className="wk-mag" aria-label={`Capa da revista TRALKED Guias, edição ${editionLabel(edition)}: ${game.name}`}>
      <div className="wk-mag-art" aria-hidden="true">
        <GameCover
          name={game.name}
          coverUrl={game.coverUrl}
          steamAppId={game.steamAppId}
          ratio="8.5 / 11"
          alt=""
          className=""
          width={300}
          sizes="300px"
        />
      </div>

      <div className="wk-mag-in">
        <div className="wk-mh">
          <svg viewBox="0 0 300 54" role="img" aria-label="TRALKED">
            <text x="0" y="50" fontSize="62" textLength="300" lengthAdjust="spacingAndGlyphs">
              TRALKED
            </text>
          </svg>
          <p className="wk-mh-ed">
            <span>Guias</span>
            <span>Edição {editionLabel(edition)}</span>
            <span>
              {MONTHS[date.getUTCMonth()]} · {date.getUTCFullYear()}
            </span>
          </p>
        </div>
  
        <div className="wk-mag-mid">
          <ul className="wk-calls">
            {cover.calls.map((call, i) => (
              <li key={i} className="wk-call">
                <b>{call.value}</b>
                <span>{call.label}</span>
              </li>
            ))}
          </ul>
          <p className="wk-seal">
            <small>TRALKED EM</small>
            <b>{sealHoursText(cover.sealHours, hours)}</b>
            <small>{runs}</small>
          </p>
        </div>
  
        <div className="wk-foot">
          <span className="wk-kick">{cover.headline}</span>
          <p className="wk-head" style={{ fontSize: `${headSize}cqw` }}>
            {lead ? `${lead} ` : null}
            <em>{last}</em>
          </p>
          <div className="wk-deck">
            <p>{cover.deck}</p>
            {game.steamAppId ? (
              <div className="wk-bc" aria-hidden="true">
                <i />
                <span>{game.steamAppId}</span>
              </div>
            ) : null}
          </div>
      </div>
      </div>
    </figure>
  );
}
