import type { TrophyTier } from "@/lib/engine/trophies";
import { getPsn, getRetro, getXbox } from "@/lib/integrations";

/** Platforms linked by verification code (Steam comes from OpenID and has its own sync). */
export type CodePlatform = "psn" | "xbox" | "retro";
export const CODE_PLATFORMS: readonly CodePlatform[] = ["psn", "xbox", "retro"];

/** One achievement/trophy of a title, with the player's unlock (if any). */
export type LibraryAchievement = {
  apiName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  hidden: boolean;
  globalPct: number | null;
  /** Native tier (PSN only). */
  trophyTier: TrophyTier | null;
  /** Xbox gamerscore or RetroAchievements points. */
  points: number | null;
  unlockedAt: Date | null;
  /** RetroAchievements: unlocked in hardcore mode. */
  hardcore: boolean;
};

/** A title the player has progress in, in the platform's own terms. */
export type LibraryTitle = {
  /** PSN npCommunicationId, Xbox titleId or RA game id. */
  externalId: string;
  name: string;
  /** Platform label stored on created games (`PS5`, `Xbox`, `Mega Drive`). */
  platformLabel: string;
  /** Null when the platform does not report playtime. */
  playtimeMin: number | null;
  achievements: LibraryAchievement[];
};

export type LibraryAccount = { externalId: string; handle: string };

/**
 * A title the sync could not read; the rest of the library is still imported.
 * Kept generic so no upstream detail (URLs, keys) ends up in logs.
 */
export type LibraryResult = {
  titles: LibraryTitle[];
  failures: { externalId: string; error: unknown }[];
  /** Current handle on the platform, when the sync learned it (RA usernames can change). */
  handle?: string;
};

async function collect<T>(
  items: T[],
  idOf: (item: T) => string,
  read: (item: T) => Promise<LibraryTitle | "private" | null>,
): Promise<LibraryResult | "private"> {
  const result: LibraryResult = { titles: [], failures: [] };
  // Sequential on purpose: the unofficial APIs rate-limit aggressively.
  for (const item of items) {
    try {
      const title = await read(item);
      if (title === "private") return "private";
      if (title && title.achievements.length > 0) result.titles.push(title);
    } catch (error) {
      result.failures.push({ externalId: idOf(item), error });
    }
  }
  return result;
}

async function readPsn(account: LibraryAccount): Promise<LibraryResult | "private"> {
  const psn = getPsn();
  const titles = await psn.getTitles(account.externalId);
  if (titles === "private") return "private";
  const played = titles.filter((t) => Object.values(t.earnedCounts).some((n) => n > 0));
  return collect(played, (t) => t.npTitleId, async (t) => {
    const trophies = await psn.getTrophies(account.externalId, t.npTitleId, t.serviceName);
    if (trophies === "private") return "private";
    return {
      externalId: t.npTitleId,
      name: t.name,
      platformLabel: t.platform.split(",")[0] || "PlayStation",
      playtimeMin: null,
      achievements: trophies.map((tr) => ({
        apiName: tr.trophyId,
        name: tr.name,
        description: tr.description,
        iconUrl: tr.iconUrl,
        hidden: tr.hidden,
        globalPct: tr.rarityPct,
        trophyTier: tr.tier,
        points: null,
        unlockedAt: tr.earned ? (tr.earnedAt ?? new Date()) : null,
        hardcore: false,
      })),
    };
  });
}

async function readXbox(account: LibraryAccount): Promise<LibraryResult | "private"> {
  const xbox = getXbox();
  const titles = await xbox.getTitles(account.externalId);
  if (titles === "private") return "private";
  const played = titles.filter((t) => t.currentAchievements > 0);
  return collect(played, (t) => t.titleId, async (t) => {
    const list = await xbox.getAchievements(account.externalId, t.titleId);
    if (list === "private") return "private";
    return {
      externalId: t.titleId,
      name: t.name,
      platformLabel: "Xbox",
      playtimeMin: null,
      achievements: list.map((a) => ({
        apiName: a.id,
        name: a.name,
        description: a.description,
        iconUrl: a.iconUrl,
        hidden: a.hidden,
        globalPct: a.rarityPct,
        trophyTier: null,
        points: a.gamerscore,
        unlockedAt: a.unlocked ? (a.unlockedAt ?? new Date()) : null,
        hardcore: false,
      })),
    };
  });
}

async function readRetro(account: LibraryAccount): Promise<LibraryResult | "private"> {
  const retro = getRetro();
  // RA usernames can change: the ULID (externalId) finds the current one.
  const profile = await retro.findProfile(account.externalId);
  const user = profile?.user ?? account.handle;
  const games = await retro.getGames(user);
  const played = games.filter((g) => g.numAwarded > 0);
  const result = await collect(played, (g) => g.gameId, async (g) => {
    const progress = await retro.getGameProgress(user, g.gameId);
    return {
      externalId: g.gameId,
      name: g.title,
      platformLabel: g.consoleName || "Retro",
      playtimeMin: progress.playtimeMin,
      achievements: progress.achievements.map((a) => ({
        apiName: a.id,
        name: a.name,
        description: a.description,
        iconUrl: a.iconUrl,
        hidden: false,
        globalPct: a.rarityPct,
        trophyTier: null,
        points: a.points,
        unlockedAt: a.earned ? (a.earnedAt ?? new Date()) : null,
        hardcore: a.hardcore,
      })),
    };
  });
  return result === "private" ? result : { ...result, handle: profile?.user };
}

/** Reads the player's whole library on one platform (titles with at least one unlock). */
export function readLibrary(
  platform: CodePlatform,
  account: LibraryAccount,
): Promise<LibraryResult | "private"> {
  switch (platform) {
    case "psn":
      return readPsn(account);
    case "xbox":
      return readXbox(account);
    case "retro":
      return readRetro(account);
  }
}
