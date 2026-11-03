import { PLATFORM_NAME, type FamilyPlayer } from "@/lib/queries/game-profile";

/*
 * "Na sua família": who in the visitor's family played this game, best platform first, with
 * hours and completion. Without a family (or logged out) it invites to the family mode.
 */

const CSS = `
.gpf { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.gpf li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px 8px 8px; background: var(--surface-2); }
.gpf-av { width: 30px; height: 30px; background: repeating-linear-gradient(135deg, var(--hover) 0 4px, var(--hover-2) 4px 8px); }
.gpf-me .gpf-av { box-shadow: inset 0 0 0 2px var(--acc); }
.gpf a { font-weight: 750; font-size: 14px; overflow-wrap: anywhere; }
.gpf a:hover { color: var(--acc); }
.gpf small { display: block; font-size: 12px; color: var(--muted); }
.gpf-pc { font-weight: 850; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.gpf-me .gpf-pc { color: var(--acc); }
`;

export function FamilyPlayers({ players, loggedIn, gameName }: { players: FamilyPlayer[] | null; loggedIn: boolean; gameName: string }) {
  return (
    <div className="gp-side">
      <style href="tralked-game-family" precedence="default">
        {CSS}
      </style>
      <h3>Na sua família</h3>
      {players === null ? (
        <>
          <p>
            {loggedIn
              ? "Monte uma família de até 6 pessoas para comparar o progresso em cada jogo."
              : "No modo família, até 6 pessoas comparam o progresso em cada jogo."}
          </p>
          <a className="gp-btn gp-btn-s" href="/familia">
            {loggedIn ? "Criar uma família" : "Conhecer o modo família"}
          </a>
        </>
      ) : players.length === 0 ? (
        <p>Ninguém da sua família jogou {gameName} ainda.</p>
      ) : (
        <ul className="gpf" aria-label={`Progresso da família em ${gameName}`}>
          {players.map((p) => (
            <li key={p.handle} className={p.me ? "gpf-me" : undefined}>
              <span className="gpf-av" aria-hidden="true" />
              <span>
                <a href={`/jogador/${encodeURIComponent(p.handle)}`}>@{p.handle}</a>
                <small>
                  {PLATFORM_NAME[p.platform]} · {Math.round(p.playtimeMin / 60).toLocaleString("pt-BR")} h
                </small>
              </span>
              <span className="gpf-pc">{p.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
