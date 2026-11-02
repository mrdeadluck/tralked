import type { CSSProperties } from "react";
import { Card } from "@/components/ui/Card";
import type { CharacterAchievement } from "@/lib/queries/players";
import { formatCompact } from "@/lib/xp-format";
import { CardHead } from "./CardHead";
import { formatAgo, formatPercent, RARITY_COLOR, RARITY_LABEL } from "./format";

type ActivityFeedProps = {
  items: CharacterAchievement[];
  /** Instante de referência para o "há X" (o servidor passa o mesmo `now` da página). */
  now: Date;
};

export function ActivityFeed({ items, now }: ActivityFeedProps) {
  return (
    <Card>
      <CardHead title="Atividade recente" />
      {items.length === 0 ? (
        <p className="pt-3.5 text-sm text-muted">Nenhuma conquista ainda.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((item) => (
            <li
              key={`${item.gameSlug}:${item.achievementName}:${item.unlockedAt.toISOString()}`}
              style={{ "--c": RARITY_COLOR[item.rarity] } as CSSProperties}
              className="grid grid-cols-[8px_1fr_auto] items-start gap-3 border-b border-divider py-3 last:border-b-0 last:pb-0"
            >
              <span aria-hidden="true" className="mt-[7px] size-2 bg-(--c)" />
              <div className="min-w-0">
                <b className="block text-[15px] font-bold">{item.achievementName}</b>
                <small className="font-mono text-xs text-dim">
                  {item.gameName}, {RARITY_LABEL[item.rarity].toLowerCase()}
                  {item.globalPct === null ? "" : ` ${formatPercent(item.globalPct)}`},{" "}
                  {formatAgo(item.unlockedAt, now)}
                </small>
              </div>
              <span className="font-mono text-xs font-bold whitespace-nowrap text-acc">
                +{formatCompact(item.xp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
