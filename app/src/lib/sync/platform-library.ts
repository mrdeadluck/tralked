import type { TrophyTier } from "@/lib/engine/trophies";
import { getPsn, getRetro, getXbox } from "@/lib/integrations";
import type { PsnPlayedGame } from "@/lib/integrations/psn/types";
import type { XboxTitle } from "@/lib/integrations/xbox/types";
import { psnConsoleCode, regionOf, xboxConsoleOf } from "@/lib/trophies/lists";
import { definitionsProblem, knownCounts, sameTierCounts, type TierCounts } from "@/lib/trophies/psn-definitions";
import { mapNewTitles } from "./psn-concepts";

/** Platforms imported by the platform sync (Steam is linked by code too, but has its own sync: lib/sync/user.ts). */
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
  /**
   * Console of the trophy list (TrophyList.console): PSN console code (`PS4`, `PS3+PSVITA`), Xbox
   * `360` | `ONE` | `PC`, RA console name; null when unknown.
   */
  console: string | null;
  /** PSN trophy service of the list (`trophy` | `trophy2`). */
  serviceName?: string;
  /** Null when the platform does not report playtime. */
  playtimeMin: number | null;
  achievements: LibraryAchievement[];
  /**
   * The counts the platform's title list showed when the title was read: the sync remembers them
   * per title (StoredProgress.listed), since the title list and the trophy list can disagree.
   */
  listed?: { unlocked: number; hardcore?: number };
};

export type LibraryAccount = { externalId: string; handle: string };

/**
 * A game with the platform's own play time, read from the platform's played-games list (PSN
 * gamelist, Xbox MinutesPlayed), with or without achievements. PSN lists each version (PS4/PS5)
 * under its own store title id; the sync adds versions of the same game up.
 */
export type PlaytimeTitle = {
  /** PSN store title id (`CUSA…`/`PPSA…`) or Xbox titleId. */
  externalId: string;
  name: string;
  platformLabel: string;
  playtimeMin: number;
  lastPlayedAt: Date | null;
  /** PSN concept of the game played (see PsnConcepts). */
  conceptId?: number | null;
};

/**
 * PSN concepts known in this run: the trophy lists whose store title ids were mapped (this run or
 * an earlier one, lib/sync/psn-concepts.ts) and, from the played-games list, each concept's store
 * title ids and name.
 */
export type PsnConcepts = {
  /** npCommunicationId → concept, for the lists mapped for this connection. */
  npToConcept: Map<string, number>;
  /** Concept → its store title ids (CUSA…/PPSA…). */
  conceptTitleIds: Map<number, string[]>;
  /**
   * Concept → a name of it without Japanese or Korean script (the concept's own name, else a
   * version's), when there is one: names the game of a list whose own name is Japanese.
   */
  conceptNames: Map<number, string>;
};

/** What the database already holds for a title (its UserTrophyList, the game's UserGame play time). */
export type StoredProgress = {
  unlocked: number;
  hardcore: number;
  /**
   * The counts the platform's title list showed when the title was last recorded (remembered by the
   * sync). A title whose listed counts equal these is up to date too: the title list and the
   * trophy list can disagree (an Xbox unlock the achievement list does not show, RA's sticky
   * hardcore flags), and the title must not be read again on every sync for it.
   */
  listed?: { unlocked: number; hardcore?: number };
  /** The row's playtime was written by a Plano 4 sync (`playtimeUpdatedAt`). */
  playtimeSynced?: boolean;
  lastPlayedAt?: Date | null;
  /** PSN: the trophy list's stored rows per tier (a list read for this user). */
  definitions?: TierCounts;
};

export type ReadOptions = {
  /**
   * Incremental sync, keyed by the title's platform id: a title whose unlock counts (and, for
   * RetroAchievements, hardcore count) in the platform's list equal what is stored is already
   * up to date and is not read again. Persistent per title, so an interrupted run resumes.
   */
  stored?: Map<string, StoredProgress>;
  /** Epoch ms after which no further title is read (the rest waits for the next run). */
  deadline?: number;
  /** At most this many titles are read per run. */
  maxTitles?: number;
  /** Titles (platform ids) not read, counted as up to date (a later pass of a resync cut short). */
  skip?: ReadonlySet<string>;
  /**
   * Xbox: titles whose minutes were already asked, with their last play then (ms, 0 unknown).
   * They are not asked again until played again, even when Xbox had no number (or 0) for them.
   */
  checkedTitles?: Map<string, number>;
  /** PSN: the LinkedAccount row, whose concept memory says which store title ids were mapped already. */
  linkedAccountId?: string;
  now?: () => number;
};

/** Titles whose minutes one Xbox sync asks at most (10 batched requests); the rest wait. */
export const MAX_MINUTES_TITLES = 250;

export type LibraryResult = {
  titles: LibraryTitle[];
  /**
   * Titles the sync could not read; the rest of the library is still imported. `backoff`: an Xbox
   * 360 title (two requests a try), retried at most once a day (platform-user.ts X360_RETRY_MS).
   */
  failures: { externalId: string; error: unknown; backoff?: boolean }[];
  /** Some titles were left for the next run (time or title budget). */
  partial: boolean;
  /** Titles already up to date (not read). */
  upToDate: number;
  /**
   * Titles read that came back with no achievements: nothing to record, but their listed counts are
   * remembered so they are not read again until those counts change.
   */
  empty: { externalId: string; listed: { unlocked: number; hardcore?: number } }[];
  /** Current handle on the platform, when the sync learned it (RA usernames can change). */
  handle?: string;
  /** Play time of the games played (PSN, Xbox); RA play time comes with each title instead. */
  playtime: PlaytimeTitle[];
  /** Xbox: titles whose minutes were asked this run → their last play (ms, 0 unknown). */
  checkedTitles?: Map<string, number>;
  /** PSN: concepts of the games played, and of the trophy lists mapped this run. */
  concepts?: PsnConcepts;
};

type Listed<T> = {
  item: T;
  id: string;
  lastUpdated: Date | null;
  /** Unlock counts the platform's title list reports. */
  unlocked: number;
  hardcore?: number;
  /** The title also carries play time: a row whose playtime predates Plano 4 is read again once. */
  carriesPlaytime?: boolean;
  /** PSN: the trophies the list defines per tier (`definedTrophies`); all zero when Sony gave none. */
  defined?: TierCounts;
};

const sameCounts = (listed: Listed<unknown>, counts: { unlocked: number; hardcore?: number }) =>
  counts.unlocked === listed.unlocked && (listed.hardcore === undefined || counts.hardcore === listed.hardcore);

/**
 * Stored counts (or the listed counts remembered for the title) match the list; play time read;
 * PSN: the stored trophies per tier are the ones the list defines (a list stored with another
 * list's trophies is read again and rebuilt).
 */
const upToDate = (listed: Listed<unknown>, stored: StoredProgress | undefined) =>
  stored !== undefined &&
  (sameCounts(listed, stored) || (stored.listed !== undefined && sameCounts(listed, stored.listed))) &&
  (!listed.carriesPlaytime || stored.playtimeSynced === true) &&
  (!knownCounts(listed.defined) || stored.definitions === undefined || sameTierCounts(listed.defined, stored.definitions));

async function collect<T>(
  items: Listed<T>[],
  options: ReadOptions,
  read: (item: T) => Promise<LibraryTitle | "private" | null>,
): Promise<LibraryResult | "private"> {
  const now = options.now ?? Date.now;
  const stored = options.stored;
  const skip = options.skip;
  const pending = items
    .filter((i) => !skip?.has(i.id))
    .filter((i) => !stored || !upToDate(i, stored.get(i.id)))
    // Oldest activity first (undated first), so interrupted runs move through the whole backlog.
    .sort((a, b) => (a.lastUpdated?.getTime() ?? 0) - (b.lastUpdated?.getTime() ?? 0));
  const result: LibraryResult = {
    titles: [],
    failures: [],
    partial: false,
    upToDate: items.length - pending.length,
    empty: [],
    playtime: [],
  };
  // Sequential on purpose: the unofficial APIs rate-limit aggressively.
  for (const [index, { item, id, unlocked, hardcore }] of pending.entries()) {
    const outOfTime = options.deadline !== undefined && now() >= options.deadline;
    const outOfTitles = options.maxTitles !== undefined && index >= options.maxTitles;
    if (outOfTime || outOfTitles) {
      result.partial = true;
      break;
    }
    try {
      const title = await read(item);
      if (title === "private") return "private";
      if (title && title.achievements.length > 0) result.titles.push({ ...title, listed: { unlocked, hardcore } });
      else if (title) result.empty.push({ externalId: id, listed: { unlocked, hardcore } });
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
    .map((t) => ({
      item: t,
      id: t.npTitleId,
      lastUpdated: t.lastPlayed,
      unlocked: Object.values(t.earnedCounts).reduce((sum, n) => sum + n, 0),
      defined: t.trophyCounts,
    }));
  const result = await collect(played, options, async (t) => {
    const trophies = await psn.getTrophies(account.externalId, t.npTitleId, t.serviceName);
    if (trophies === "private") return "private";
    // An answer that cannot be this list's (Sony once served another title's list for an id) is a
    // failed read: nothing is written and the next run reads the title again.
    const problem = definitionsProblem(t.npTitleId, t.trophyCounts, trophies);
    if (problem) throw new Error(`PSN trophy definitions of ${t.npTitleId} do not match the list: ${problem}`);
    return {
      externalId: t.npTitleId,
      name: t.name,
      // The whole list label ("PS4,PS5"): a game created from it records every console.
      platformLabel: t.platform || "PlayStation",
      console: psnConsoleCode(t.platform),
      serviceName: t.serviceName,
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
  if (result === "private") return result;
  // Play time is a separate list (one request per 200 games), read on every sync unless the run is
  // out of time (the next one reads it). Hidden gaming history or an outage only leaves play time
  // out: trophies still import.
  // Play time is one request per 200 games: read even when the trophies ran out of time, so hours
  // do not wait for a big first import to finish.
  if (options.deadline !== undefined && (options.now ?? Date.now)() >= options.deadline) result.partial = true;
  try {
    const games = await psn.getPlayedGames(account.externalId);
    if (games !== "private") {
      result.playtime = games.map((g) => ({
        externalId: g.titleId,
        name: g.name,
        platformLabel: g.category === "ps4_game" ? "PS4" : "PS5",
        playtimeMin: g.playtimeMin,
        lastPlayedAt: g.lastPlayedAt,
        conceptId: g.conceptId,
      }));
      result.concepts = await conceptsOf(account, games, options.linkedAccountId, options.deadline);
    }
  } catch (error) {
    result.failures.push({ externalId: "played-games", error });
  }
  return result;
}

/**
 * Concepts of the played games, plus the trophy lists known for the connection: those learned
 * before and those of store title ids not mapped yet (at most MAX_NEW_CONCEPT_TITLES per sync, no
 * request after the read deadline). A failed mapping only leaves this run without the new lists'
 * concepts: trophies still import, and the ids are asked again next sync.
 */
async function conceptsOf(
  account: LibraryAccount,
  games: PsnPlayedGame[],
  linkedAccountId: string | undefined,
  deadline: number | undefined,
): Promise<PsnConcepts> {
  const conceptTitleIds = new Map<number, string[]>();
  const conceptNames = new Map<number, string>();
  // The concept's own name first, then the versions' names.
  for (const g of [...games].sort((a, b) => Number(b.conceptName !== null) - Number(a.conceptName !== null))) {
    if (g.conceptId === null) continue;
    const ids = new Set([...(conceptTitleIds.get(g.conceptId) ?? []), ...g.conceptTitleIds, g.titleId]);
    conceptTitleIds.set(g.conceptId, [...ids]);
    const name = [g.conceptName, g.name].find((n) => n && regionOf(n) === null);
    if (name && !conceptNames.has(g.conceptId)) conceptNames.set(g.conceptId, name);
  }
  let npToConcept = new Map<string, number>();
  if (linkedAccountId) {
    try {
      npToConcept = await mapNewTitles(account.externalId, linkedAccountId, games, undefined, deadline);
    } catch (error) {
      console.warn("Platform sync: could not map PSN title ids to their trophy lists (concepts)", error);
    }
  }
  return { npToConcept, conceptTitleIds, conceptNames };
}

/**
 * Why an Xbox 360 list cannot be the title's (null when it can): the history's totals are real for
 * 360 titles, so a list shorter than `totalAchievements`, or empty while the history counts unlocks,
 * is a failed read, never a list recorded smaller (or a 100% that is not one).
 */
export function x360SizeProblem(title: XboxTitle, listed: number): string | null {
  if (listed === 0 && title.currentAchievements > 0) {
    return `no achievements listed, ${title.currentAchievements} unlocked in the history`;
  }
  if (listed < title.totalAchievements) return `${listed} of the ${title.totalAchievements} achievements of the history listed`;
  return null;
}

async function readXbox(account: LibraryAccount, options: ReadOptions): Promise<LibraryResult | "private"> {
  const xbox = getXbox();
  const titles = await xbox.getTitles(account.externalId);
  if (titles === "private") return "private";
  const played = titles
    .filter((t) => t.currentAchievements > 0)
    .map((t) => ({ item: t, id: t.titleId, lastUpdated: t.lastPlayed, unlocked: t.currentAchievements }));
  const result = await collect(played, options, async (t) => {
    const list = await xbox.getAchievements(account.externalId, t.titleId, t.devices);
    if (list === "private") return "private";
    const problem = t.devices.includes("Xbox360") ? x360SizeProblem(t, list.length) : null;
    if (problem) throw new Error(`Xbox 360 title ${t.titleId}: ${problem}`);
    return {
      externalId: t.titleId,
      name: t.name,
      platformLabel: "Xbox",
      console: xboxConsoleOf(t.devices),
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
  if (result === "private") return result;
  const x360 = new Set(titles.filter((t) => t.devices.includes("Xbox360")).map((t) => t.titleId));
  for (const f of result.failures) if (x360.has(f.externalId)) f.backoff = true;
  // Minutes played of every title in the history (achievements or not), asked only for titles
  // played since they were last asked (or since the stored row), at most MAX_MINUTES_TITLES per
  // run, in batches, and not after the deadline. Best effort, like PSN's.
  const stored = options.stored;
  const checked = options.checkedTitles;
  const due = titles
    .filter((t) => {
      const lastMs = t.lastPlayed?.getTime() ?? 0;
      const before = stored?.get(t.titleId);
      if (before?.playtimeSynced && (lastMs === 0 || (before.lastPlayedAt && lastMs <= before.lastPlayedAt.getTime()))) {
        return false;
      }
      const askedAt = checked?.get(t.titleId);
      return askedAt === undefined || lastMs > askedAt;
    })
    // Most recently played first: those are the ones that changed.
    .sort((a, b) => (b.lastPlayed?.getTime() ?? 0) - (a.lastPlayed?.getTime() ?? 0));
  const now = options.now ?? Date.now;
  const asked = due.slice(0, MAX_MINUTES_TITLES);
  if (due.length > asked.length) result.partial = true;
  if (asked.length > 0 && options.deadline !== undefined && now() >= options.deadline) {
    result.partial = true;
  } else if (asked.length > 0) {
    try {
      const minutes = await xbox.getMinutesPlayed(account.externalId, asked.map((t) => t.titleId));
      if (minutes !== "private") {
        result.checkedTitles = new Map(asked.map((t) => [t.titleId, t.lastPlayed?.getTime() ?? 0]));
        result.playtime = asked.flatMap((t) => {
          const value = minutes.get(t.titleId);
          return value !== undefined && value > 0
            ? [{ externalId: t.titleId, name: t.name, platformLabel: "Xbox", playtimeMin: value, lastPlayedAt: t.lastPlayed }]
            : [];
        });
      }
    } catch (error) {
      result.failures.push({ externalId: "minutes-played", error });
    }
  }
  return result;
}

async function readRetro(account: LibraryAccount, options: ReadOptions): Promise<LibraryResult | "private"> {
  const retro = getRetro();
  // RA usernames can change: the ULID (externalId) finds the current one.
  const profile = await retro.findProfile(account.externalId);
  const user = profile?.user ?? account.handle;
  const games = await retro.getGames(user);
  const played = games
    .filter((g) => g.numAwarded > 0)
    .map((g) => ({
      item: g,
      id: g.gameId,
      lastUpdated: g.lastPlayed,
      unlocked: g.numAwarded,
      hardcore: g.numAwardedHardcore,
      carriesPlaytime: true,
    }));
  const result = await collect(played, options, async (g) => {
    const progress = await retro.getGameProgress(user, g.gameId);
    return {
      externalId: g.gameId,
      name: g.title,
      platformLabel: g.consoleName || "Retro",
      console: g.consoleName || null,
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
