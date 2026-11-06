import { PLATFORM_TOKEN } from "@/components/character/platforms";
import { formatGlobalPct } from "@/components/profile/format";
import { RARITY_UI } from "@/components/guide/format";
import type { PlatformId, TrophyTier } from "@/lib/engine/trophies";
import { rarityTier } from "@/lib/engine/xp";
import { PLATFORM_NAME, safeMediaUrl } from "@/lib/queries/game-profile";
import type { GameVersion, PlayerVersion } from "@/lib/queries/game-versions";

/*
 * Copy and view data for a game's versions (the hero's version rows and the trophy tabs under the
 * hero), built on the server in pt-BR. The tabs get the public part once (versionTabs, the first
 * rows of each version) and the player's marks apart (versionMarks, a small map by apiName), so a
 * long list never travels twice; the whole list comes on demand (publicTrophies).
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

const FAMILY: Record<PlatformId, string> = { psn: "PlayStation", xbox: "Xbox", steam: "Steam", retro: "RetroAchievements" };

/**
 * The ficha's "Conquistas": per family (PlayStation, Xbox, Steam, RA) the trophies of its largest
 * version, never the regional lists added up; the largest family first (ties: the versions' order).
 */
export function familyTotals(versions: GameVersion[]): { family: string; total: number }[] {
  const best = new Map<string, number>();
  for (const v of versions) best.set(FAMILY[v.platform], Math.max(best.get(FAMILY[v.platform]) ?? 0, v.total));
  return [...best].map(([family, total]) => ({ family, total })).sort((a, b) => b.total - a.total);
}

/** "na Steam", "no Xbox". */
const onFamily = (name: string) => `${name === "Xbox" || name === "RetroAchievements" ? "no" : "na"} ${name}`;

/**
 * The ficha's "Conquistas" cell: the largest family's count, then the others ("78" · "na
 * PlayStation · 77 na Steam · 49 no Xbox"), as the approved mockup. Without versions (lists not
 * known yet), the catalog's per-platform numbers.
 */
export function achievementsFact(
  versions: GameVersion[],
  main: { platform: PlatformId; total: number },
  byPlatform: { platform: PlatformId; total: number }[],
): { value: number; note: string } {
  const families = versions.length > 0
    ? familyTotals(versions)
    : [main, ...byPlatform.filter((p) => p.platform !== main.platform)].map((p) => ({ family: PLATFORM_NAME[p.platform], total: p.total }));
  const [head, ...rest] = families;
  return {
    value: head.total,
    note: [onFamily(head.family), ...rest.map((f) => `${fmt(f.total)} ${onFamily(f.family)}`)].join(" · "),
  };
}

// ---------- Trophy tabs ----------

const TIER_UI: Record<TrophyTier, { label: string; color: string }> = {
  platinum: { label: "Platina", color: "var(--plat)" },
  gold: { label: "Ouro", color: "var(--gold)" },
  silver: { label: "Prata", color: "var(--silver)" },
  bronze: { label: "Bronze", color: "var(--bronze)" },
};

export type TabChip = { label: string; ok: boolean };

/** Rows a tab carries in the page; the whole list comes on "Ver a lista inteira" (publicTrophies). */
export const FIRST_ROWS = 12;

/** One trophy as anyone sees it (no marks): the same for every viewer, so it can be cached. */
export type VersionTabTrophy = {
  apiName: string;
  /** Null for a hidden trophy: its text never leaves the server unless the viewer earned it. */
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  /** "Ouro" (PSN tier) or "Rara · 9,7%" (rarity elsewhere). */
  chip: { label: string; color: string } | null;
  /** "4,1% dos jogadores" (PSN; elsewhere the share is in the chip). */
  share: string | null;
};

/** The public part of a tab: the version, its visitor copy and its first FIRST_ROWS trophies. */
export type VersionTab = {
  key: string;
  label: string;
  fullLabel: string;
  color: string;
  /** "troféu" or "conquista" (gender of "não obtido"/"não obtida", "oculto"/"oculta"). */
  noun: "troféu" | "conquista";
  /** The visitor's badge: the number of trophies. */
  badge: string;
  meta: { strong: string; rest: string };
  trophies: VersionTabTrophy[];
  /** Every trophy of the version (the rows shown come first). */
  count: number;
};

/** One earned trophy of the player. */
export type TrophyMark = {
  date: string;
  xp: number | null;
  /** The regional lists it was earned in, each with its date (a version with several lists). */
  lists: { label: string; date: string }[];
  /** Where the XP came from; on the version's first trophy earned in several lists only. */
  why: string | null;
  /** A hidden trophy the player earned: its text and icon, for them only. */
  reveal: { name: string; description: string | null; iconUrl: string | null } | null;
};

/** The player's marks on one version they have: badge, meta line and each earned trophy. */
export type VersionMarks = {
  /** "Platina", "100%", "20/59", "64%". */
  badge: string;
  /** The badge reads as done (gold): the platinum or the 100%. */
  done: boolean;
  meta: { strong: string; rest: string; chips: TabChip[]; note: string | null };
  /** apiName -> mark; a trophy missing here is "não obtido". */
  earned: Record<string, TrophyMark>;
};

/** What the per-user island streams into the tabs: the marks by version and the tab to open on. */
export type TabsMarks = { initial: string; aside: string | null; byKey: Record<string, VersionMarks> };

/** "na Lista 1 em 14/04/2022 e na 🇯🇵 Ásia em 02/09/2023". */
function whereWhen(dates: { label: string; at: Date }[]): string {
  const parts = dates.map((d) => `na ${d.label} em ${dayLabel(d.at)}`);
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function publicTrophy(v: GameVersion, t: GameVersion["trophies"][number]): VersionTabTrophy {
  const rarity = t.globalPct === null ? null : rarityTier(t.globalPct);
  const chip = isTrophy(v)
    ? TIER_UI[t.tier]
    : rarity
      ? { label: `${RARITY_UI[rarity].label} · ${formatGlobalPct(t.globalPct!)}`, color: RARITY_UI[rarity].color }
      : null;
  return {
    apiName: t.apiName,
    name: t.hidden ? null : t.name,
    description: t.hidden ? null : t.description,
    iconUrl: t.hidden ? null : safeMediaUrl(t.iconUrl),
    chip,
    share: isTrophy(v) && t.globalPct !== null ? `${formatGlobalPct(t.globalPct)} dos jogadores` : null,
  };
}

/** One tab per version, in the versions' order, with the first FIRST_ROWS trophies of each. */
export function versionTabs(versions: GameVersion[]): VersionTab[] {
  return versions.map((v) => {
    const labelled = v.lists.filter((l) => l.label);
    const on = onVersion(v);
    return {
      key: v.key,
      label: shortLabel(v),
      fullLabel: v.label,
      color: versionColor(v),
      noun: isTrophy(v) ? "troféu" : "conquista",
      badge: fmt(v.total),
      meta: {
        strong: `${fmt(v.total)} ${nounOf(v, v.total)}`,
        rest: labelled[0] ? ` ${on} · ${labelled.length} listas regionais, mostrando a ${labelled[0].label}` : ` ${on}`,
      },
      trophies: v.trophies.slice(0, FIRST_ROWS).map((t) => publicTrophy(v, t)),
      count: v.trophies.length,
    };
  });
}

/**
 * A version's whole public list ("Ver a lista inteira"): the panel replaces its first rows with it,
 * so a list read later (a sync may have reordered it) never mixes with the one in the page.
 */
export function publicTrophies(v: GameVersion): VersionTabTrophy[] {
  return v.trophies.map((t) => publicTrophy(v, t));
}

function versionMarksOf(v: GameVersion, mine: PlayerVersion): VersionMarks {
  const on = onVersion(v);
  const chips = mine.lists.filter((l) => l.label).map((l) => ({ label: l.label!, ok: l.complete }));
  const earned: Record<string, TrophyMark> = {};
  let said = false;
  for (const t of v.trophies) {
    const at = mine.unlockedAt[t.apiName];
    if (!at) continue;
    const dates = mine.earnedAt[t.apiName] ?? [];
    const dateIn = new Map(dates.map((d) => [d.label, dayLabel(d.at)]));
    // The XP note is said once per version (on its first trophy earned in several lists).
    const why =
      dates.length > 1 && !said
        ? `Obtido ${whereWhen(dates)}. O XP veio da primeira; ${
            dates.length === 2 ? "a segunda aparece, mas não soma" : "as outras aparecem, mas não somam"
          }.`
        : null;
    if (why) said = true;
    earned[t.apiName] = {
      date: dayLabel(at),
      xp: mine.xp[t.apiName] ?? null,
      lists: (mine.earnedIn[t.apiName] ?? []).map((label) => ({ label, date: dateIn.get(label) ?? "" })),
      why,
      reveal: t.hidden ? { name: t.name, description: t.description, iconUrl: safeMediaUrl(t.iconUrl) } : null,
    };
  }
  return {
    badge: mine.platinum
      ? "Platina"
      : mine.pct >= 100
        ? "100%"
        : isTrophy(v)
          ? `${fmt(mine.unlocked)}/${fmt(mine.total)}`
          : `${mine.pct}%`,
    done: mine.platinum || mine.pct >= 100,
    meta: {
      strong: `${fmt(mine.unlocked)} de ${fmt(mine.total)} ${nounOf(v, mine.total)}`,
      rest:
        mine.pct >= 100
          ? ` ${on} · 100%`
          : ` ${on} · ${leftLabel(mine.unlocked, mine.total)} para ${v.nativePlatinum ? "platinar" : "a Platina Tralked"}`,
      chips,
      note:
        chips.length > 1
          ? "As listas regionais são iguais: cada troféu mostra em quais você o obteve, e o XP conta uma vez."
          : null,
    },
    earned,
  };
}

/**
 * The player's marks on the tabs: one entry per version they have (the others read as a
 * visitor's), opening on the disc's version (bestVersion). Null for a player without any.
 */
export function versionMarks(versions: GameVersion[], player: PlayerVersion[] | null): TabsMarks | null {
  const byKey: Record<string, VersionMarks> = {};
  const mine: PlayerVersion[] = [];
  for (const p of player ?? []) {
    const v = versions.find((x) => x.key === p.key);
    if (!v) continue;
    byKey[p.key] = versionMarksOf(v, p);
    mine.push(p);
  }
  const best = bestVersion(mine);
  if (!best) return null;
  return {
    initial: best.key,
    aside: versions.length > 1 ? "Uma aba por versão · as suas marcas em cada uma" : "Com as suas marcas",
    byKey,
  };
}
