import Link from "next/link";
import { ViewTransition } from "react";
import { SKILLS } from "@/lib/engine/types";
import {
  boardHref,
  isPlainBoard,
  METRIC_LABEL,
  METRICS,
  NIVEL_TAB_HREF,
  SCOPE_LABEL,
  type Board,
  type Metric,
} from "@/lib/highscores/boards";
import { RANK_SCOPES } from "@/lib/highscores/stats";

/** The board a category tab opens: the platform carries over between stat boards. */
function boardFor(metric: Metric, current: Board): Board {
  if (metric === "nivel" || metric === "semana" || metric === "novatos") return { metric };
  if (metric === "genero") return { metric, skill: current.metric === "genero" ? current.skill : SKILLS[0].id };
  return { metric, scope: "scope" in current ? current.scope : "all" };
}

/**
 * Category tabs (links, so they work without JS) with an underline that glides to the chosen tab
 * (a shared view transition), and the platform or genre chips of the current category.
 */
export function BoardNav({ board }: { board: Board }) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Categorias do ranking" className="-mx-1 overflow-x-auto">
        <ul className="m-0 flex min-w-max list-none gap-1 border-b border-line p-0 px-1">
          {METRICS.map((metric) => {
            const active = metric === board.metric;
            return (
              <li key={metric}>
                {/* Same tab as the profile and the news (mono, uppercase); the underline glides. */}
                <Link
                  href={metric === "nivel" ? NIVEL_TAB_HREF : boardHref(boardFor(metric, board))}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={`relative inline-flex h-11 items-center px-3.5 font-mono text-xs tracking-[0.1em] whitespace-nowrap uppercase transition-colors ${
                    active ? "font-bold text-text" : "text-text-3 hover:text-text"
                  }`}
                >
                  {METRIC_LABEL[metric]}
                  {active ? (
                    <ViewTransition name="highscores-tab" share="auto" default="none">
                      <span aria-hidden="true" className="absolute inset-x-0 -bottom-px block h-0.5 bg-acc" />
                    </ViewTransition>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {board.metric === "genero" ? (
        <Chips
          label="Gênero"
          items={SKILLS.map((s) => ({
            key: s.id,
            label: s.name,
            href: boardHref({ metric: "genero", skill: s.id }),
            active: s.id === board.skill,
          }))}
        />
      ) : !isPlainBoard(board) ? (
        <Chips
          label="Plataforma"
          items={RANK_SCOPES.map((scope) => ({
            key: scope,
            label: SCOPE_LABEL[scope],
            href: boardHref({ metric: board.metric, scope }),
            active: scope === board.scope,
          }))}
        />
      ) : null}
    </div>
  );
}

function Chips({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden="true" className="mr-1 font-mono text-xs tracking-[0.1em] text-dim uppercase">
        {label}
      </span>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          scroll={false}
          className={`inline-flex h-11 items-center rounded-[2px] border px-3 font-mono text-xs tracking-[0.08em] uppercase transition-colors sm:h-[34px] ${
            item.active
              ? "border-text bg-text font-bold text-bg"
              : "border-line-2 text-text-3 hover:border-dim hover:text-text"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
