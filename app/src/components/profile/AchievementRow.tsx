import Link from "next/link";
import { RARITY_COLOR, RARITY_LABEL } from "@/components/character/format";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { Chip } from "@/components/ui/Chip";
import type { ProfileAchievement } from "@/lib/profile/queries";
import { formatDate, formatGlobalPct } from "./format";

const TROPHY_LABEL: Record<string, string> = { platinum: "Platina", gold: "Ouro", silver: "Prata", bronze: "Bronze" };

function Icon({ achievement, size }: { achievement: ProfileAchievement; size: number }) {
  return achievement.iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- platform icon hosts are external
    <img
      src={achievement.iconUrl}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      className="flex-none rounded-[2px] border border-line object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-[2px] border border-line font-mono text-xs text-dim"
      style={{ width: size, height: size, backgroundImage: "var(--stripes)" }}
    >
      ★
    </span>
  );
}

function Rarity({ achievement }: { achievement: ProfileAchievement }) {
  return (
    <Chip color={RARITY_COLOR[achievement.rarity]}>
      {RARITY_LABEL[achievement.rarity]}
      {achievement.globalPct !== null ? ` · ${formatGlobalPct(achievement.globalPct)}` : ""}
    </Chip>
  );
}

/** One unlocked achievement of a player: icon, name, game, platform, rarity and date. */
export function AchievementRow({ achievement }: { achievement: ProfileAchievement }) {
  return (
    <li className="flex items-start gap-3.5 border-b border-line py-3.5">
      <Icon achievement={achievement} size={48} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] leading-tight font-extrabold">{achievement.name}</h3>
        {achievement.description ? <p className="mt-0.5 text-sm text-text-3">{achievement.description}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Link href={`/jogos/${achievement.game.slug}`} className="mr-1 text-sm font-semibold text-text-2 hover:text-acc">
            {achievement.game.name}
          </Link>
          <Chip color={PLATFORM_TOKEN[achievement.platform]}>{PLATFORM_LABEL[achievement.platform]}</Chip>
          {achievement.trophyTier && TROPHY_LABEL[achievement.trophyTier] ? (
            <Chip plain>{TROPHY_LABEL[achievement.trophyTier]}</Chip>
          ) : null}
          <Rarity achievement={achievement} />
        </div>
      </div>
      <div className="flex-none text-right font-mono text-xs text-dim">
        <time dateTime={achievement.unlockedAt.toISOString()}>{formatDate(achievement.unlockedAt)}</time>
        <p className="mt-1 text-acc">+{achievement.xp.toLocaleString("pt-BR")} XP</p>
      </div>
    </li>
  );
}
