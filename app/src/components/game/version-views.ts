import { PLATFORM_TOKEN } from "@/components/character/platforms";
import { formatGlobalPct } from "@/components/profile/format";
import { RARITY_UI } from "@/components/guide/format";
import type { PlatformId, TrophyTier } from "@/lib/engine/trophies";
import { rarityTier } from "@/lib/engine/xp";
import { safeMediaUrl } from "@/lib/queries/game-profile";
import type { GameVersion, PlayerVersion } from "@/lib/queries/game-versions";

/*
 * Copy and view data for a game's versions (the hero's version rows and the trophy tabs under the
 * hero), built on the server in pt-BR so the tabs (a client island) only pick one.
 */

const fmt = (n: number) => n.toLocaleString("pt-BR");
const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
/** "14/04/2022", Brasília time. */
export const dayLabel = (d: Date) => DAY.format(d);

type Labelled = { platform: PlatformId; label: string };

/** The rows' and tabs' short name: Xbox titles read "Xbox" or "360"; the rest keep their label. */
export function shortLabel(v: Labelled): string {
  if (v.platform !== "xbox") return v.label;
  return v.label === "Xbox 360" ? "360" : "Xbox";
}

export const versionColor = (v: { platform: PlatformId }) => PLATFORM_TOKEN[v.platform];

/** PSN versions have trophies; the others achievements. */
const isTrophy = (v: { platform: PlatformId }) => v.platform === "psn";
export const nounOf = (v: { platform: PlatformId }, n: number) =>
  isTrophy(v) ? (n === 1 ? "troféu" : "troféus") : n === 1 ? "conquista" : "conquistas";

/** "na Steam", "no PS5", "no Xbox 360". */
export const onVersion = (v: Labelled) => (v.platform === "steam" ? "na Steam" : `no ${v.label}`);

/** "Troféus", "Conquistas" or "Troféus e conquistas", by what the versions have. */
export function trophyWord(versions: { platform: PlatformId }[]): string {
  const psn = versions.some(isTrophy);
  const other = versions.some((v) => !isTrophy(v));
  return psn && other ? "Troféus e conquistas" : psn ? "Troféus" : "Conquistas";
}

/** The version the disc shows: a platinum first, then the highest percentage, then more unlocks. */
export function bestVersion(mine: PlayerVersion[]): PlayerVersion | null {
  return (
    [...mine].sort((a, b) => Number(b.platinum) - Number(a.platinum) || b.pct - a.pct || b.unlocked - a.unlocked)[0] ??
    null
  );
}

/** "falta 1" / "faltam 39". */
export const leftLabel = (unlocked: number, total: number) => {
  const n = Math.max(0, total - unlocked);
  return n === 1 ? "falta 1" : `faltam ${fmt(n)}`;
};

// ---------- Trophy tabs ----------

const TIER_UI: Record<TrophyTier, { label: string; color: string }> = {
  platinum: { label: "Platina", color: "var(--plat)" },
  gold: { label: "Ouro", color: "var(--gold)" },
  silver: { label: "Prata", color: "var(--silver)" },
  bronze: { label: "Bronze", color: "var(--bronze)" },
};

export type TabChip = { label: string; ok: boolean };

export type VersionTabTrophy = {
  apiName: string;
  /** Null for a hidden trophy the viewer has not earned: its text stays on the server. */
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  /** "Ouro" (PSN tier) or "Rara · 9,7%" (rarity elsewhere). */
  chip: { label: string; color: string } | null;
  /** "4,1% dos jogadores" (PSN; elsewhere the share is in the chip). */
  share: string | null;
  /** The viewer's mark: null for a visitor or a version the player does not have. */
  mark:
    | { earned: false }
    | {
        earned: true;
        date: string;
        xp: number | null;
        /** The regional lists it was earned in, each with its date (a version with several lists). */
        lists: { label: string; date: string }[];
        /** Where the XP came from; on the panel's first trophy earned in several lists only. */
        why: string | null;
      }
    | null;
};

export type VersionTab = {
  key: string;
  label: string;
  fullLabel: string;
  color: string;
  /** "78", "Platina", "20/59", "64%". */
  badge: string;
  /** The badge reads as done (gold): the platinum or the 100%. */
  done: boolean;
  /** "troféu" or "conquista" (gender of "não obtido"/"não obtida", "oculto"/"oculta"). */
  noun: "troféu" | "conquista";
  meta: { strong: string; rest: string; chips: TabChip[]; note: string | null };
  trophies: VersionTabTrophy[];
};

/** "na Lista 1 em 14/04/2022 e na 🇯🇵 Ásia em 02/09/2023". */
function whereWhen(dates: { label: string; at: Date }[]): string {
  const parts = dates.map((d) => `na ${d.label} em ${dayLabel(d.at)}`);
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function trophyView(v: GameVersion, t: GameVersion["trophies"][number], mine: PlayerVersion | null): VersionTabTrophy {
  const at = mine?.unlockedAt[t.apiName] ?? null;
  const masked = t.hidden && !at;
  const rarity = t.globalPct === null ? null : rarityTier(t.globalPct);
  const chip = isTrophy(v)
    ? TIER_UI[t.tier]
    : rarity
      ? { label: `${RARITY_UI[rarity].label} · ${formatGlobalPct(t.globalPct!)}`, color: RARITY_UI[rarity].color }
      : null;
  let mark: VersionTabTrophy["mark"] = null;
  if (mine) {
    if (!at) mark = { earned: false };
    else {
      const dates = mine.earnedAt[t.apiName] ?? [];
      const dateIn = new Map(dates.map((d) => [d.label, dayLabel(d.at)]));
      mark = {
        earned: true,
        date: dayLabel(at),
        xp: mine.xp[t.apiName] ?? null,
        lists: (mine.earnedIn[t.apiName] ?? []).map((label) => ({ label, date: dateIn.get(label) ?? "" })),
        why:
          dates.length > 1
            ? `Obtido ${whereWhen(dates)}. O XP veio da primeira; ${
                dates.length === 2 ? "a segunda aparece, mas não soma" : "as outras aparecem, mas não somam"
              }.`
            : null,
      };
    }
  }
  return {
    apiName: t.apiName,
    name: masked ? null : t.name,
    description: masked ? null : t.description,
    iconUrl: masked ? null : safeMediaUrl(t.iconUrl),
    chip,
    share: isTrophy(v) && t.globalPct !== null ? `${formatGlobalPct(t.globalPct)} dos jogadores` : null,
    mark,
  };
}

/** The XP note is said once per list (on its first trophy earned in several lists), not on every row. */
function oneWhy(trophies: VersionTabTrophy[]): VersionTabTrophy[] {
  let said = false;
  return trophies.map((t) => {
    if (!t.mark?.earned || !t.mark.why) return t;
    if (!said) {
      said = true;
      return t;
    }
    return { ...t, mark: { ...t.mark, why: null } };
  });
}

function tabMeta(v: GameVersion, mine: PlayerVersion | null): VersionTab["meta"] {
  const on = onVersion(v);
  const labelled = v.lists.filter((l) => l.label);
  if (!mine) {
    const first = labelled[0]?.label;
    return {
      strong: `${fmt(v.total)} ${nounOf(v, v.total)}`,
      rest: first ? ` ${on} · ${labelled.length} listas regionais, mostrando a ${first}` : ` ${on}`,
      chips: [],
      note: null,
    };
  }
  const chips = mine.lists.filter((l) => l.label).map((l) => ({ label: l.label!, ok: l.complete }));
  const rest =
    mine.pct >= 100
      ? ` ${on} · 100%`
      : ` ${on} · ${leftLabel(mine.unlocked, mine.total)} para ${v.nativePlatinum ? "platinar" : "a Platina Tralked"}`;
  return {
    strong: `${fmt(mine.unlocked)} de ${fmt(mine.total)} ${nounOf(v, mine.total)}`,
    rest,
    chips,
    note:
      chips.length > 1
        ? "As listas regionais são iguais: cada troféu mostra em quais você o obteve, e o XP conta uma vez."
        : null,
  };
}

/**
 * One tab per version, in the versions' order. With `player`, the versions the player has carry
 * their marks and the first selected is the disc's (bestVersion); the others read as a visitor's.
 */
export function versionTabs(versions: GameVersion[], player: PlayerVersion[] | null): { tabs: VersionTab[]; initial: string } {
  const mineByKey = new Map((player ?? []).map((p) => [p.key, p]));
  const tabs = versions.map((v): VersionTab => {
    const mine = mineByKey.get(v.key) ?? null;
    const done = Boolean(mine && (mine.platinum || mine.pct >= 100));
    const badge = !mine
      ? fmt(v.total)
      : mine.platinum
        ? "Platina"
        : mine.pct >= 100
          ? "100%"
          : isTrophy(v)
            ? `${fmt(mine.unlocked)}/${fmt(mine.total)}`
            : `${mine.pct}%`;
    return {
      key: v.key,
      label: shortLabel(v),
      fullLabel: v.label,
      color: versionColor(v),
      badge,
      done,
      noun: isTrophy(v) ? "troféu" : "conquista",
      meta: tabMeta(v, mine),
      trophies: oneWhy(v.trophies.map((t) => trophyView(v, t, mine))),
    };
  });
  const best = bestVersion([...mineByKey.values()].filter((p) => versions.some((v) => v.key === p.key)));
  return { tabs, initial: best?.key ?? tabs[0]?.key ?? "" };
}
