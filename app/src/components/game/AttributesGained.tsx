import type { CSSProperties } from "react";
import type { GameAttributes } from "@/lib/queries/game-profile";
import { formatCompact } from "@/lib/xp-format";

/*
 * "O que este jogo deu ao seu personagem": what this one game added to the visitor's character
 * (XP from its achievements, Vigor, Precisão, Glória, Coleção and the level of its main genre),
 * by the same formulas as the attribute recompute. Logged out, a blurred sample character sits
 * behind an invitation to sign in, instead of six dashes.
 */

const CSS = `
.gpa-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; }
.gpa { background: var(--surface); padding: 14px; display: flex; flex-direction: column; gap: 4px; }
.gpa-k { font-stretch: 75%; font-weight: 700; font-size: 12.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.gpa-v { display: flex; align-items: center; gap: 6px; font-weight: 900; font-stretch: 112%; font-size: 24px; line-height: 1.05; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; color: var(--acc); }
.gpa[data-k="skill"] .gpa-v { color: var(--text); }
.gpa-v svg { width: 10px; height: 10px; color: var(--acc); }
.gpa p { font-size: 12.5px; color: var(--text-2); }
.gpa-src { margin-top: auto; font-size: 12px; color: var(--muted); }
.gpa-sample { position: relative; }
.gpa-sample .gpa-grid { filter: blur(5px); opacity: .55; user-select: none; pointer-events: none; }
.gpa-gate { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; background: linear-gradient(180deg, transparent, color-mix(in oklch, var(--surface) 88%, transparent) 45%); }
.gpa-gate strong { display: block; font-weight: 900; font-stretch: 105%; font-size: 19px; text-transform: uppercase; }
.gpa-gate p { max-width: 44ch; margin: 6px auto 16px; font-size: 14px; color: var(--text-2); }
.gpa-none { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px; background: var(--surface); }
.gpa-none strong { font-weight: 900; font-stretch: 105%; font-size: 19px; text-transform: uppercase; }
.gpa-none p { max-width: 60ch; font-size: 14.5px; color: var(--text-2); margin-bottom: 8px; }
@media (max-width: 1100px) { .gpa-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 480px) { .gpa-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

const fmt = (n: number) => n.toLocaleString("pt-BR");

type Cell = {
  key: string;
  label: string;
  value: string | null;
  up: boolean;
  text: string;
  source: string;
};

function Up() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2 11 10H1z" fill="currentColor" />
    </svg>
  );
}

function cells(a: GameAttributes | null, genre: string | null): Cell[] {
  const plus = (n: number) => (n > 0 ? `+${fmt(n)}` : "0");
  const plural = (n: number, one: string, many: string) =>
    `${fmt(n)} ${n === 1 ? one : many}`;
  return [
    {
      key: "xp",
      label: "XP total",
      value: a ? formatCompact(a.xp) : null,
      up: false,
      text: "Soma de todas as conquistas, pela raridade.",
      source: "conquistas",
    },
    {
      key: "vigor",
      label: "Vigor",
      value: a ? plus(a.vigor) : null,
      up: Boolean(a && a.vigor > 0),
      text: a
        ? `${plural(a.hours, "hora jogada vira", "horas jogadas viram")} resistência.`
        : "Horas jogadas viram resistência.",
      source: "pontos · tempo de jogo",
    },
    {
      key: "precisao",
      label: "Precisão",
      value: a ? plus(a.precisao) : null,
      up: Boolean(a && a.precisao > 0),
      text: a
        ? `${plural(a.rareCount, "conquista", "conquistas")} com até 5% de jogadores.`
        : "Conquistas que até 5% dos jogadores têm.",
      source: "pontos · raridade",
    },
    {
      key: "gloria",
      label: "Glória",
      value: a ? plus(a.gloria) : null,
      up: Boolean(a && a.gloria > 0),
      text: "Troféus de ouro valem mais que bronze; a platina vale mais que todos.",
      source: "pontos · troféus",
    },
    {
      key: "colecao",
      label: "Coleção",
      value: a ? plus(a.colecao) : null,
      up: Boolean(a && a.colecao > 0),
      text: a?.completed
        ? "Jogo completo: já está na sua coleção."
        : "Completar este jogo em 100% dá +250.",
      source: "pontos · jogos 100%",
    },
    {
      key: "skill",
      label: a?.skill?.name ?? genre ?? "Gênero",
      value: a?.skill ? fmt(a.skill.level) : null,
      up: false,
      text: a?.skill
        ? a.skill.levelsFromGame > 0
          ? `+${plural(a.skill.levelsFromGame, "nível veio", "níveis vieram")} deste jogo.`
          : "Este jogo ainda não subiu o nível do gênero."
        : "Cada conquista sobe a habilidade do gênero do jogo.",
      source: "nível · gênero",
    },
  ];
}

export function AttributesGained({
  attributes,
  loggedIn,
  genre,
  aside,
  loginHref,
  sample,
  gameName,
}: {
  attributes: GameAttributes | null;
  loggedIn: boolean;
  /** Name of the game's main genre (for the logged-out skill cell). */
  genre: string | null;
  aside: string | null;
  loginHref: string;
  /**
   * What a 100% in this game gives a new character, from the game's own achievements (shown
   * blurred behind the sign-in invitation). Null for a game without achievements.
   */
  sample: GameAttributes | null;
  gameName: string;
}) {
  const noAchievements = sample === null;
  const shown = loggedIn ? (attributes ?? null) : sample;
  const zero: GameAttributes | null =
    loggedIn && !attributes
      ? {
          xp: 0,
          hours: 0,
          vigor: 0,
          precisao: 0,
          rareCount: 0,
          gloria: 0,
          colecao: 0,
          completed: false,
          skill: null,
        }
      : null;

  return (
    <section
      className="gp-veil"
      style={{ "--d": ".5s" } as CSSProperties}
      aria-labelledby="gp-h-attr"
    >
      <style href="tralked-game-attributes" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id="gp-h-attr">O que este jogo deu ao seu personagem</h2>
        {loggedIn ? (
          aside ? (
            <span className="gp-aside">{aside}</span>
          ) : null
        ) : (
          <a className="gp-aside gp-aside-link" href={loginHref}>
            Entre para ver os seus
          </a>
        )}
      </div>
      {noAchievements && !attributes ? (
        // Nothing to unlock: no sample character, no row of zeros. The hours are what counts.
        <div className="gpa-none">
          <strong>Sem conquistas: aqui vale o tempo jogado</strong>
          <p>
            {gameName} não tem conquistas. Cada hora jogada vira Vigor e Resistência no seu personagem.
          </p>
          {loggedIn ? null : (
            <a className="gp-btn gp-btn-acc tk-cut-b" href={loginHref}>
              Entrar e conectar
            </a>
          )}
        </div>
      ) : loggedIn ? (
        <Grid list={cells(shown ?? zero, genre)} />
      ) : (
        <div className="gpa-sample">
          <div aria-hidden="true" inert>
            <Grid list={cells(shown, genre)} />
          </div>
          <div className="gpa-gate">
            <div>
              <strong>Veja o seu personagem</strong>
              <p>
                Conecte Steam, PSN ou Xbox e o Tralked calcula o que este jogo já deu a você. Ao fundo, o
                que um 100% nele dá a um personagem novo.
              </p>
              <a className="gp-btn gp-btn-acc tk-cut-b" href={loginHref}>
                Entrar e conectar
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Grid({ list }: { list: Cell[] }) {
  return (
    <div className="gpa-grid">
      {list.map((c) => (
        <div key={c.key} className="gpa" data-k={c.key}>
          <span className="gpa-k">{c.label}</span>
          <span className="gpa-v">
            {c.value ?? "—"}
            {c.up ? <Up /> : null}
          </span>
          <p>{c.text}</p>
          <span className="gpa-src">{c.source}</span>
        </div>
      ))}
    </div>
  );
}
