import Link from "next/link";
import type { CSSProperties } from "react";
import type { CharacterAchievement } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import { formatAgo, formatPercent, RARITY_COLOR, RARITY_LABEL } from "./format";
import { Panel, PANEL_LINK } from "./Panel";

type ActivityFeedProps = {
  items: CharacterAchievement[];
  /** Instante de referência para o "há X" (o servidor passa o mesmo `now` da página). */
  now: Date;
  /** The player's calendar (the same unlocks, day by day). */
  calendar?: { href: string; label: string };
};

export function ActivityFeed({ items, now, calendar }: ActivityFeedProps) {
  return (
    <Panel
      title="Atividade recente"
      aside={
        calendar ? (
          <Link href={calendar.href} className={PANEL_LINK}>
            {calendar.label}
          </Link>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma conquista ainda.</p>
      ) : (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {items.map((item) => (
            <li
              key={`${item.gameSlug}:${item.achievementName}:${item.unlockedAt.toISOString()}`}
              style={{ "--c": RARITY_COLOR[item.rarity] } as CSSProperties}
              className="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-2.5 bg-surface-2 py-2 pr-2.5"
            >
              <span aria-hidden="true" className="self-stretch bg-(--c)" />
              <div className="min-w-0">
                <b className="block text-sm leading-tight font-bold">{item.achievementName}</b>
                <small className="text-xs text-muted">
                  <Link href={`/jogos/${item.gameSlug}`} className="hover:text-text hover:underline">
                    {item.gameName}
                  </Link>
                  {" · "}
                  <em className="font-bold text-(--c) not-italic">
                    {RARITY_LABEL[item.rarity].toLowerCase()}
                    {item.globalPct === null ? "" : ` ${formatPercent(item.globalPct)}`}
                  </em>
                  {" · "}
                  {formatAgo(item.unlockedAt, now)}
                </small>
              </div>
              <span className="text-[13.5px] font-extrabold whitespace-nowrap text-acc tabular-nums">
                +{formatCompact(item.xp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
