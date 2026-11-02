import { PLATFORM_NAME, type FamilyPlayer } from "@/lib/queries/game-profile";

/*
 * "Na sua família": who in the visitor's family played this game, best platform first, with
 * hours and completion. Without a family (or logged out) it invites to the family mode.
 */

const CSS = `
.gpf { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.gpf li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--divider); }
.gpf li:last-child { border-bottom: 0; }
.gpf-av { width: 34px; height: 34px; border-radius: 50%; background: repeating-linear-gradient(135deg, #1c1e24 0 4px, #24262d 4px 8px); }
.gpf-me .gpf-av { border: 2px solid var(--acc); }
.gpf a { font-weight: 700; font-size: 14.5px; overflow-wrap: anywhere; }
.gpf a:hover { color: var(--acc); }
.gpf small { display: block; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; color: var(--dim); }
.gpf-pc { font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
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
          <a className="gp-btn" href="/familia">
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
