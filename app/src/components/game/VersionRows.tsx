import type { CSSProperties } from "react";
import type { GameVersion, PlayerVersion } from "@/lib/queries/game-versions";
import { nounOf, shortLabel, versionColor } from "./version-views";

/*
 * The hero's version rows, under the disc (in place of the old platform switch): one row per
 * version (a console or store) with its name, and for a player the progress bar, the regional
 * lists as chips (✓ = that list complete) and the PLATINA seal or the percentage. A visitor sees
 * the versions the game has, with their number of trophies and no marks. Presentational only.
 */

export const VERSION_ROWS_CSS = `
.vr { display: grid; grid-template-columns: minmax(84px, max-content) minmax(0, 1fr) auto; gap: 2px 0; width: 100%; margin: 0; padding: 0; list-style: none; }
.vr li { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; column-gap: 12px; row-gap: 4px; align-items: center; padding: 9px 12px 9px 10px; background: color-mix(in oklch, var(--surface) 88%, transparent); }
.vr-n { display: flex; flex-direction: column; min-width: 0; }
.vr-n b { display: flex; align-items: center; gap: 6px; max-width: 150px; font-stretch: 80%; font-weight: 800; font-size: 13.5px; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.vr-n b > span { overflow: hidden; text-overflow: ellipsis; }
.vr-n b::before { content: ""; width: 6px; height: 6px; flex: none; background: var(--c, var(--muted)); }
.vr-n small { padding-left: 12px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.vr-bar { position: relative; display: block; height: 6px; overflow: hidden; background: var(--track); }
.vr-bar i { position: absolute; inset: 0 auto 0 0; background: var(--acc-dim); }
.vr-bar i[data-done] { background: var(--acc); }
.vr-rg { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 6px; }
.vr-rg:first-child { margin-top: 0; }
.vr-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 20px; padding: 0 6px; background: var(--track); font-stretch: 80%; font-weight: 750; font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; }
.vr-ok { color: var(--acc); font-weight: 900; }
.vr-note { font-size: 12px; color: var(--muted); white-space: nowrap; }
.vr-seal { display: inline-flex; align-items: center; justify-content: center; min-width: 52px; height: 24px; padding: 0 8px; background: var(--hover-2); font-weight: 900; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; font-variant-numeric: tabular-nums; color: var(--text-2); }
.vr-seal[data-plat] { color: var(--gold); }
.vr-seal[data-count] { color: var(--text); font-weight: 800; }
@media (max-width: 400px) { .vr li { column-gap: 8px; padding-inline: 8px; } .vr { grid-template-columns: minmax(74px, max-content) minmax(0, 1fr) auto; } }
`;

const fmt = (n: number) => n.toLocaleString("pt-BR");

function Name({ v, small }: { v: { platform: GameVersion["platform"]; label: string }; small?: string }) {
  const short = shortLabel(v);
  return (
    <div className="vr-n">
      <b style={{ "--c": versionColor(v) } as CSSProperties} title={short === v.label ? undefined : v.label}>
        <span>{short}</span>
        {short === v.label ? null : <span className="sr-only"> ({v.label})</span>}
      </b>
      {small ? <small>{small}</small> : null}
    </div>
  );
}

function Chip({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span className="vr-chip" data-chip="">
      {label}
      {ok ? (
        <>
          <span className="vr-ok" aria-hidden="true">
            ✓
          </span>
          <span className="sr-only">completa</span>
        </>
      ) : null}
    </span>
  );
}

function PlayerRow({ p }: { p: PlayerVersion }) {
  const chips = p.lists.filter((l) => l.label);
  const bar = (
    <span
      className="vr-bar"
      role="progressbar"
      aria-label={p.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p.pct}
    >
      <i data-done={p.pct >= 100 ? "" : undefined} style={{ width: `${p.pct}%` }} />
    </span>
  );
  return (
    <li>
      <Name v={p} small={`${fmt(p.unlocked)}/${fmt(p.total)}`} />
      {chips.length > 0 ? (
        <div>
          {bar}
          <div className="vr-rg">
            {chips.map((l) => (
              <Chip key={l.id} label={l.label!} ok={l.complete} />
            ))}
            {p.countedNote ? <span className="vr-note">{p.countedNote}</span> : null}
          </div>
        </div>
      ) : (
        bar
      )}
      {p.platinum ? (
        <span className="vr-seal tk-cut-sm" data-plat="">
          Platina
        </span>
      ) : (
        <span className="vr-seal tk-cut-sm">{p.pct}%</span>
      )}
    </li>
  );
}

function VisitorRow({ v }: { v: GameVersion }) {
  const chips = v.lists.filter((l) => l.label);
  return (
    <li>
      <Name v={v} />
      {chips.length > 0 ? (
        <div className="vr-rg">
          {chips.map((l) => (
            <Chip key={l.id} label={l.label!} />
          ))}
          <span className="vr-note">{`${v.lists.length} listas · conta 1`}</span>
        </div>
      ) : (
        <span className="vr-note">{nounOf(v, v.total)}</span>
      )}
      <span className="vr-seal tk-cut-sm" data-count="">
        {fmt(v.total)}
      </span>
    </li>
  );
}

/**
 * Player mode (`player`): one row per version the player has, in their order; `versions` is not
 * read. Visitor mode (`versions` only): every version of the game, unmarked.
 */
export function VersionRows({
  versions = [],
  player,
  label,
}: {
  /** The game's versions (visitor mode). */
  versions?: GameVersion[];
  /** The player's versions; given, the rows are theirs. */
  player?: PlayerVersion[] | null;
  label: string;
}) {
  return (
    <>
      <style href="tralked-game-version-rows" precedence="default">
        {VERSION_ROWS_CSS}
      </style>
      <ul className="vr tk-cut-sm" aria-label={label}>
        {player ? player.map((p) => <PlayerRow key={p.key} p={p} />) : versions.map((v) => <VisitorRow key={v.key} v={v} />)}
      </ul>
    </>
  );
}
