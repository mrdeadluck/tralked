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
  unlocked: boolean;
  /** Null when unlocked but the platform gives no date (the sync then uses the first-seen time). */
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

export type ReadOptions = {
  /**
   * Incremental sync: titles whose last activity is at or before this instant are skipped
   * (titles without an activity date are always read).
   */
  since?: Date | null;
  /** Epoch ms after which no further title is read (the rest waits for the next run). */
  deadline?: number;
  now?: () => number;
};

export type LibraryResult = {
  titles: LibraryTitle[];
  /** Titles the sync could not read; the rest of the library is still imported. */
  failures: { externalId: string; error: unknown }[];
  /** Some titles were left for the next run (time budget). */
  partial: boolean;
  /** Current handle on the platform, when the sync learned it (RA usernames can change). */
  handle?: string;
};

type Listed<T> = { item: T; id: string; lastUpdated: Date | null };

async function collect<T>(
  items: Listed<T>[],
  options: ReadOptions,
  read: (item: T) => Promise<LibraryTitle | "private" | null>,
): Promise<LibraryResult | "private"> {
  const now = options.now ?? Date.now;
  const result: LibraryResult = { titles: [], failures: [], partial: false };
  const since = options.since ?? null;
  const pending = items.filter((i) => !since || !i.lastUpdated || i.lastUpdated > since);
  // Sequential on purpose: the unofficial APIs rate-limit aggressively.
  for (const { item, id } of pending) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      result.partial = true;
      break;
    }
    try {
      const title = await read(item);
      if (title === "private") return "private";
      if (title && title.achievements.length > 0) result.titles.push(title);
    } catch (error) {
      result.failures.push({ externalId: id, error });
    }
  }
  return result;
}

async function readPsn(account: LibraryAccount, options: ReadOptions): Promise<LibraryResult | "private"> {
  const psn = getPsn();
  const titles = await psn.getTitles(account.externalId);
  if (titles === "private") return "private";
  const played = titles
    .filter((t) => Object.values(t.earnedCounts).some((n) => n > 0))
    .map((t) => ({ item: t, id: t.npTitleId, lastUpdated: t.lastPlayed }));
  return collect(played, options, async (t) => {
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
        unlocked: tr.earned,
        unlockedAt: tr.earned ? tr.earnedAt : null,
        hardcore: false,
      })),
    };
  });
}

async function readXbox(account: LibraryAccount, options: ReadOptions): Promise<LibraryResult | "private"> {
  const xbox = getXbox();
  const titles = await xbox.getTitles(account.externalId);
  if (titles === "private") return "private";
  const played = titles
    .filter((t) => t.currentAchievements > 0)
    .map((t) => ({ item: t, id: t.titleId, lastUpdated: t.lastPlayed }));
  return collect(played, options, async (t) => {
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
        unlocked: a.unlocked,
        unlockedAt: a.unlocked ? a.unlockedAt : null,
        hardcore: false,
      })),
    };
  });
}

async function readRetro(account: LibraryAccount, options: ReadOptions): Promise<LibraryResult | "private"> {
  const retro = getRetro();
  // RA usernames can change: the ULID (externalId) finds the current one.
  const profile = await retro.findProfile(account.externalId);
  const user = profile?.user ?? account.handle;
  const games = await retro.getGames(user);
  const played = games
    .filter((g) => g.numAwarded > 0)
    .map((g) => ({ item: g, id: g.gameId, lastUpdated: g.lastPlayed }));
  const result = await collect(played, options, async (g) => {
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
        unlocked: a.earned,
        unlockedAt: a.earned ? a.earnedAt : null,
        hardcore: a.hardcore,
      })),
    };
  });
  return result === "private" ? result : { ...result, handle: profile?.user };
}

/** Reads the player's library on one platform (titles with at least one unlock). */
export function readLibrary(
  platform: CodePlatform,
  account: LibraryAccount,
  options: ReadOptions = {},
): Promise<LibraryResult | "private"> {
  switch (platform) {
    case "psn":
      return readPsn(account, options);
    case "xbox":
      return readXbox(account, options);
    case "retro":
      return readRetro(account, options);
  }
}
