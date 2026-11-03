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
