import { timeoutSignal, XBOX_FETCH_TIMEOUT_MS } from "../http";
import type { XboxAchievement, XboxApi, XboxProfile, XboxTitle } from "./types";

/**
 * Xbox Live through OpenXBL (xbl.io), an unofficial proxy of the Xbox Live APIs. The API key
 * belongs to Tralked's own service account; users never hand over credentials.
 * Errors only ever carry the endpoint name and HTTP status, never the key.
 */

const BASE = "https://xbl.io/api/v2";

export type XboxClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

type Setting = { id: string; value: string };

type TitleRecord = {
  titleId: string | number;
  name: string;
  achievement?: {
    currentAchievements?: number;
    totalAchievements?: number;
    currentGamerscore?: number;
    totalGamerscore?: number;
    progressPercentage?: number;
  };
  titleHistory?: { lastTimePlayed?: string };
  /** Devices the title runs on (`Xbox360`, `XboxOne`, `XboxSeries`, `PC`, `Win32`, ...). */
  devices?: unknown;
};

type AchievementRecord = {
  id: string | number;
  name: string;
  description?: string;
  lockedDescription?: string;
  isSecret?: boolean;
  progressState?: string;
  progression?: { timeUnlocked?: string };
  mediaAssets?: { type?: string; url?: string }[];
  rewards?: { type?: string; value?: string | number }[];
  rarity?: { currentPercentage?: number };
};

/**
 * Xbox 360 achievement in the 360 service's shape: of `/achievements/player/{xuid}/title/{titleId}`
 * (every achievement of the title, state a placeholder) and `/achievements/x360/{xuid}/title/{titleId}`
 * (only those the player earned, with the real state and date).
 */
type X360AchievementRecord = {
  id: string | number;
  name: string;
  description?: string;
  lockedDescription?: string;
  isSecret?: boolean;
  unlocked?: boolean;
  unlockedOnline?: boolean;
  gamerscore?: number | string;
  imageId?: number | string;
  timeUnlocked?: string;
  rarity?: { currentPercentage?: number };
};

/** A 360 route's answer (unwrapped from `content`); a bare array is accepted too. */
type X360Response = { achievements?: unknown; pagingInfo?: { continuationToken?: string | null } } | unknown[];

type StatsResponse = {
  statlistscollection?: {
    stats?: { name?: string; titleid?: string | number; value?: string | number }[];
  }[];
};

type StatsBody = (xuid: string, titleIds: string[]) => Record<string, unknown>;

/** Request shapes for Xbox Live user stats through OpenXBL, most likely first (see getMinutesPlayed). */
const STATS_BODIES: StatsBody[] = [
  (xuid, ids) => ({
    arrangebyfield: "xuid",
    xuids: [xuid],
    groups: ids.map((titleId) => ({ name: "Hero", titleId })),
    stats: ids.map((titleId) => ({ name: "MinutesPlayed", titleId })),
  }),
  (xuid, ids) => ({ arrangebyfield: "xuid", xuids: [xuid], stats: ids.map((titleId) => ({ name: "MinutesPlayed", titleId })) }),
  (xuid, ids) => ({ arrangebyfield: "xuid", xuids: [xuid], stats: ids.map((titleid) => ({ name: "MinutesPlayed", titleid })) }),
  (xuid, ids) => ({ xuids: [xuid], stats: ids.map((titleId) => ({ name: "MinutesPlayed", titleId })) }),
  (xuid, ids) => ({ arrangebyfield: "xuid", xuids: [Number(xuid)], stats: ids.map((titleId) => ({ name: "MinutesPlayed", titleId: Number(titleId) })) }),
];
/** Index of the shape OpenXBL accepted last (1 as of 2026-11-01; kept for the life of the server instance). */
let statsShape = 1;

/** Titles per stats request (one batch request covers many titles). */
const STATS_BATCH = 25;

/** `MinutesPlayed` per title from a user-stats batch answer (missing or unreadable values left out). */
export function parseMinutesPlayed(body: StatsResponse): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const list of body.statlistscollection ?? []) {
    for (const stat of list.stats ?? []) {
      if (stat.name !== "MinutesPlayed" || stat.titleid === undefined) continue;
      const value = Number(stat.value);
      if (Number.isFinite(value) && value >= 0) minutes.set(String(stat.titleid), Math.floor(value));
    }
  }
  return minutes;
}

// Xbox reports locked achievements with this placeholder time.
const NEVER = "0001-01-01T00:00:00.0000000Z";

const dateOrNull = (value: string | undefined) => {
  if (!value || value === NEVER) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 ? null : date;
};

/** A record is usable only with an id and a non-empty name (else it would become the id "undefined"). */
const validRecord = (a: { id?: unknown; name?: unknown } | null): boolean =>
  !!a && (typeof a.id === "string" || typeof a.id === "number") && typeof a.name === "string" && a.name.trim() !== "";

/**
 * An Xbox 360 achievement in the app's shape: what it is from its definition, the player's state
 * only from the earned record (the definition's state is a placeholder: never unlocked, a 2002
 * date). The icon is the 360 image CDN's (title and image ids in hex).
 */
function x360Achievement(a: X360AchievementRecord, earned: X360AchievementRecord | undefined, titleId: string): XboxAchievement {
  const unlocked = earned !== undefined && (earned.unlocked === true || earned.unlockedOnline === true);
  const title = Number(titleId);
  const image = Number(a.imageId);
  return {
    id: String(a.id),
    name: a.name,
    description: a.description || a.lockedDescription || null,
    iconUrl:
      Number.isInteger(title) && Number.isInteger(image) && a.imageId !== undefined
        ? `https://image-ssl.xboxlive.com/global/t.${title.toString(16)}/ach/0/${image.toString(16)}`
        : null,
    hidden: a.isSecret ?? false,
    gamerscore: Number(a.gamerscore ?? 0) || 0,
    unlocked,
    unlockedAt: unlocked ? dateOrNull(earned.timeUnlocked) : null,
    rarityPct: a.rarity?.currentPercentage ?? earned?.rarity?.currentPercentage ?? null,
  };
}

export function createXboxClient({ apiKey, fetch: fetchImpl = globalThis.fetch }: XboxClientConfig): XboxApi {
  async function get<T>(path: string, what: string, body?: unknown): Promise<T | "private" | null> {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Authorization": apiKey,
        Accept: "application/json",
        "Accept-Language": "pt-BR",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: timeoutSignal(XBOX_FETCH_TIMEOUT_MS),
    });
    if (res.status === 403 || res.status === 404) {
      // What OpenXBL answered (its error text, no personal data) tells a typo from an outage.
      const text = await res.text().catch(() => "");
      console.warn(`Xbox ${what}: HTTP ${res.status} ${text.slice(0, 200)}`);
      return res.status === 403 ? "private" : null;
    }
    if (!res.ok) throw new Error(`Xbox ${what} failed with HTTP ${res.status}`);
    const json = (await res.json()) as T & { content?: T };
    // Some OpenXBL answers come wrapped in `content`.
    return (json && typeof json === "object" && json.content && typeof json.content === "object" ? json.content : json) as T;
  }

  /** The account settings of a XUID: gamertag, bio and picture. */
  async function accountProfile(xuid: string, fallbackGamertag: string | null): Promise<XboxProfile | null> {
    const account = await get<{ profileUsers?: { id: string; settings?: Setting[] }[] }>(
      `/account/${encodeURIComponent(xuid)}`,
      "account",
    );
    if (account === null || account === "private") return null;
    const settings = new Map((account.profileUsers?.[0]?.settings ?? []).map((s) => [s.id, s.value]));
    const gamertag = settings.get("Gamertag") ?? fallbackGamertag;
    if (!gamertag) return null;
    return {
      xuid,
      gamertag,
      bio: settings.get("Bio") ?? "",
      avatarUrl: settings.get("GameDisplayPicRaw") ?? null,
    };
  }

  /**
   * The player route. Only a 200 whose `achievements` is an array can say a title is empty: a 404 or
   * a body of another shape is unknown and throws, so the title is a failure (retried), not "empty".
   */
  async function playerAchievements(xuid: string, titleId: string): Promise<XboxAchievement[] | "private"> {
    const body = await get<{ achievements?: AchievementRecord[] }>(
      `/achievements/player/${encodeURIComponent(xuid)}/${encodeURIComponent(titleId)}`,
      "achievements",
    );
    if (body === "private") return "private";
    if (body === null) throw new Error("Xbox achievements: title not found (HTTP 404)");
    if (!Array.isArray(body.achievements)) throw new Error("Xbox achievements: unexpected answer");
    return body.achievements.filter(validRecord).map((a) => {
      const unlocked = a.progressState === "Achieved";
      const score = a.rewards?.find((r) => r.type === "Gamerscore")?.value;
      return {
        id: String(a.id),
        name: a.name,
        description: a.description || a.lockedDescription || null,
        iconUrl: a.mediaAssets?.find((m) => m.type === "Icon")?.url ?? null,
        hidden: a.isSecret ?? false,
        gamerscore: Number(score ?? 0) || 0,
        unlocked,
        unlockedAt: unlocked ? dateOrNull(a.progression?.timeUnlocked) : null,
        rarityPct: a.rarity?.currentPercentage ?? null,
      };
    });
  }

  /**
   * The records of one 360 route. As on the player route, a 404, a body of another shape or a list
   * cut into pages (a continuation token) is unknown and throws: the title is a failed read. A 403
   * throws too: the account's history answered (getTitles), so a refusal of one 360 route is that
   * title's failure (retried after X360_RETRY_MS), never the account turning private.
   */
  async function x360Records(path: string, what: string): Promise<X360AchievementRecord[]> {
    const body = await get<X360Response>(path, what);
    if (body === "private") throw new Error(`Xbox ${what}: refused (HTTP 403)`);
    if (body === null) throw new Error(`Xbox ${what}: title not found (HTTP 404)`);
    const raw = Array.isArray(body) ? body : body.achievements;
    if (!Array.isArray(raw)) throw new Error(`Xbox ${what}: unexpected answer`);
    if (!Array.isArray(body) && body.pagingInfo?.continuationToken) {
      throw new Error(`Xbox ${what}: the list has more than one page (${raw.length} records on the first)`);
    }
    const records = (raw as (X360AchievementRecord | null)[]).filter(
      (a): a is X360AchievementRecord => !!a && (typeof a.id === "string" || typeof a.id === "number"),
    );
    if (records.length < raw.length) console.warn(`Xbox ${what}: ${raw.length - records.length} record(s) without an id left out`);
    // One record per id (the first): a repeated id would count an achievement twice.
    const byId = new Map<string, X360AchievementRecord>();
    for (const a of records) if (!byId.has(String(a.id))) byId.set(String(a.id), a);
    return [...byId.values()];
  }

  /**
   * An Xbox 360 title, in two requests: every achievement of the title (the definitions route, whose
   * state is a placeholder) joined by id with the player's earned ones (the 360 route), so the list
   * has its real size. Both must answer: else the title is a failed read and nothing is written.
   */
  async function x360Achievements(xuid: string, titleId: string): Promise<XboxAchievement[]> {
    const path = `${encodeURIComponent(xuid)}/title/${encodeURIComponent(titleId)}`;
    // A 403 on either route throws (x360Records): the title fails, the account stays as it is.
    const definitions = await x360Records(`/achievements/player/${path}`, "360 achievements");
    const earnedRecords = await x360Records(`/achievements/x360/${path}`, "360 earned achievements");
    const earned = new Map(earnedRecords.map((a) => [String(a.id), a]));
    // A definition without a name takes the earned record's; one with neither is left out.
    const named = definitions.map((a) => (validRecord(a) ? a : { ...a, name: earned.get(String(a.id))?.name ?? "" }));
    const usable = named.filter(validRecord);
    if (usable.length < named.length) {
      console.warn(`Xbox 360 title ${titleId}: ${named.length - usable.length} achievement(s) without a name left out`);
    }
    const listed = new Set(usable.map((a) => String(a.id)));
    const missing = [...earned.keys()].filter((id) => !listed.has(id));
    if (missing.length > 0) {
      throw new Error(`Xbox 360 title ${titleId}: earned achievement(s) ${missing.join(", ")} not in its list`);
    }
    return usable.map((a) => x360Achievement(a, earned.get(String(a.id)), titleId));
  }

  return {
    async findProfile(gamertag): Promise<XboxProfile | null> {
      const search = await get<{
        people?: { xuid?: string; id?: string; gamertag?: string; modernGamertag?: string }[];
      }>(`/search/${encodeURIComponent(gamertag)}`, "search");
      if (search === null || search === "private") return null;
      const wanted = gamertag.toLowerCase().replace(/\s+/g, "");
      const people = search.people ?? [];
      const person = people.find(
        (p) =>
          p.gamertag?.toLowerCase().replace(/\s+/g, "") === wanted ||
          p.modernGamertag?.toLowerCase().replace(/\s+/g, "") === wanted,
      );
      const xuid = person?.xuid ?? person?.id;
      if (!person || !xuid) {
        console.warn(
          `Xbox search: no exact match among ${people.length} result(s) (keys: ${Object.keys(search).join(",")}; first: ${people
            .slice(0, 3)
            .map((p) => p.modernGamertag ?? p.gamertag)
            .join(", ")})`,
        );
        return null;
      }

      return accountProfile(xuid, person.gamertag ?? gamertag);
    },

    getProfile: (xuid) => accountProfile(xuid, null),

    async getTitles(xuid): Promise<XboxTitle[] | "private"> {
      const body = await get<{ titles?: TitleRecord[] }>(
        `/achievements/player/${encodeURIComponent(xuid)}`,
        "titles",
      );
      if (body === "private") return "private";
      return (body?.titles ?? []).map((t) => ({
        titleId: String(t.titleId),
        name: t.name,
        currentAchievements: t.achievement?.currentAchievements ?? 0,
        totalAchievements: t.achievement?.totalAchievements ?? 0,
        currentGamerscore: t.achievement?.currentGamerscore ?? 0,
        totalGamerscore: t.achievement?.totalGamerscore ?? 0,
        progress: t.achievement?.progressPercentage ?? 0,
        lastPlayed: dateOrNull(t.titleHistory?.lastTimePlayed),
        devices: Array.isArray(t.devices) ? t.devices.filter((d): d is string => typeof d === "string") : [],
      }));
    },

    async getAchievements(xuid, titleId, devices = []): Promise<XboxAchievement[] | "private"> {
      // Xbox 360 titles answer empty on the player route: they have routes of their own.
      return devices.includes("Xbox360") ? x360Achievements(xuid, titleId) : playerAchievements(xuid, titleId);
    },

    async getMinutesPlayed(xuid, titleIds): Promise<Map<string, number> | "private"> {
      // OpenXBL forwards this batch to Xbox Live user stats ("MinutesPlayed", as Exophase reads it).
      // Its accepted body shape is not documented: the shapes below are tried in turn and the first
      // one OpenXBL accepts is kept for the following requests.
      const minutes = new Map<string, number>();
      for (let i = 0; i < titleIds.length; i += STATS_BATCH) {
        const batch = titleIds.slice(i, i + STATS_BATCH);
        let lastError = "";
        let answered = false;
        for (let k = 0; k < STATS_BODIES.length && !answered; k++) {
          const shape = (statsShape + k) % STATS_BODIES.length;
          const body = await get<StatsResponse>("/player/stats", "stats", STATS_BODIES[shape](xuid, batch));
          if (body === "private") return "private";
          if (body === null) {
            answered = true;
            continue;
          }
          const error = body as { ErrorType?: unknown; Description?: unknown };
          if (error.ErrorType !== undefined) {
            lastError = `${String(error.ErrorType)} ${String(error.Description ?? "").slice(0, 120)}`;
            continue;
          }
          if (shape !== statsShape) console.warn(`Xbox stats: body shape ${shape} accepted`);
          statsShape = shape;
          answered = true;
          for (const [titleId, value] of parseMinutesPlayed(body)) minutes.set(titleId, value);
        }
        // OpenXBL relays Xbox Live errors as { ErrorType, Description }: a failure, so the titles are
        // asked again next time instead of being remembered as having no minutes.
        if (!answered) throw new Error(`Xbox stats refused every body shape: ${lastError}`);
      }
      return minutes;
    },
  };
}
