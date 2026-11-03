import type { GuideDb } from "./db.js";
import type { GuideDossierSource, SteamAchievement } from "./dossier.js";
import type { SourceRef } from "./sources.js";

/**
 * What a request ran on, saved after discovery: the dry run (`pnpm guia -- --ensaio`) replays the request on it
 * without calling the site, the search or a model.
 */
export type RunContext = {
  requestId: string;
  steamAppId: number;
  gameSlug: string;
  game: GuideDossierSource["game"];
  /** `GET /dossie?all=1`: every platform's rows. */
  steamList: SteamAchievement[];
  sources: SourceRef[];
  savedAt: string;
};

const PREFIX = "guia-contexto:";

export function saveRunContext(db: GuideDb, context: RunContext): void {
  db.setMeta(`${PREFIX}${context.requestId}`, JSON.stringify(context));
}

function parse(value: string | undefined): RunContext | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as RunContext;
  } catch {
    return undefined;
  }
}

export function loadRunContext(db: GuideDb, requestId: string): RunContext | undefined {
  return parse(db.getMeta(`${PREFIX}${requestId}`));
}

/** The latest saved context of a game's requests. */
export function latestRunContext(db: GuideDb, steamAppId: number): RunContext | undefined {
  const rows = db.raw.prepare("SELECT value FROM meta WHERE key LIKE ?").all(`${PREFIX}%`) as unknown as { value: string }[];
  return rows
    .map((r) => parse(r.value))
    .filter((c): c is RunContext => c !== undefined && c.steamAppId === steamAppId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
}

/** How long a discovery (the web searches, paid) is reused for the same request or game. */
export const DISCOVERY_REUSE_DAYS = 7;

/**
 * The saved discovery a new attempt can reuse instead of searching again: the request's own, else the latest of the
 * same game, when it is at most `DISCOVERY_REUSE_DAYS` old (`savedAt` is the discovery's date).
 */
export function reusableDiscovery(db: GuideDb, requestId: string, steamAppId: number, now: Date): RunContext | undefined {
  const saved = loadRunContext(db, requestId) ?? latestRunContext(db, steamAppId);
  if (!saved || saved.steamAppId !== steamAppId || !Array.isArray(saved.sources) || saved.sources.length === 0) return undefined;
  const age = now.getTime() - Date.parse(saved.savedAt);
  return age >= 0 && age <= DISCOVERY_REUSE_DAYS * 24 * 60 * 60 * 1000 ? saved : undefined;
}
