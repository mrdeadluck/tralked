import Link from "next/link";
import { ViewTransition } from "react";
import { SKILLS } from "@/lib/engine/types";
import {
  boardHref,
  METRIC_LABEL,
  METRICS,
  SCOPE_LABEL,
  type Board,
  type Metric,
} from "@/lib/highscores/boards";
import { RANK_SCOPES } from "@/lib/highscores/stats";

/** The board a category tab opens: the platform carries over between stat boards. */
function boardFor(metric: Metric, current: Board): Board {
  if (metric === "nivel") return { metric };
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
                <Link
                  href={boardHref(boardFor(metric, board))}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={`relative block px-3 py-3 text-sm font-bold whitespace-nowrap transition-colors ${
                    active ? "text-text" : "text-muted hover:text-text"
                  }`}
                >
                  {METRIC_LABEL[metric]}
                  {active ? (
                    <ViewTransition name="highscores-tab" share="auto" default="none">
                      <span aria-hidden="true" className="absolute inset-x-2 -bottom-px block h-[3px] rounded-[2px] bg-acc" />
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
      ) : board.metric !== "nivel" ? (
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
      <span aria-hidden="true" className="mr-1 text-xs text-dim">
        {label}
      </span>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          scroll={false}
          className={`inline-flex h-8 items-center rounded-[2px] border px-3 text-[13px] transition-colors ${
            item.active
              ? "border-text bg-text font-bold text-bg"
              : "border-line-2 text-text-3 hover:border-text-3 hover:text-text"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
