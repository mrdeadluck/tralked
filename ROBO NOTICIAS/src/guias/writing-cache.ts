import { createHash } from "node:crypto";
import type { GuidePayloadV2 } from "./contract.js";
import type { GuideDb } from "./db.js";
import type { GuideDossier, GuideDossierSource } from "./dossier.js";
import type { PsnWriteScope } from "./scope.js";
import { buildSkeleton } from "./skeleton.js";
import { loadGuideStyle, type GuideModels } from "./writer.js";

/**
 * The writer's approved output (the payload after `writeAndCheckGuide` said ok, before images and soundtrack),
 * kept in the GuideDb. A new attempt, or another request of the same game (the production run after a local one),
 * reuses it without calling the AI when nothing it was written from changed: the dossier (minus the pages that
 * could not be read, which vary from run to run), the scope, the skeleton, the game, the style prompt and the
 * models. Images and soundtrack are added on every send: the media URLs belong to each site.
 */

export type CachedWriting = { payload: GuidePayloadV2; internalErrors: string[]; savedAt: string };

/**
 * Bump this number whenever the writer (frameMessage, jobMessage, assemble), the checker (its prompts), the
 * skeleton or the guide contract change: a writing cached by older code must not be reused.
 */
export const WRITER_CACHE_VERSION = 2;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Steam rarity in coarse bands: the site refreshes it every day; the writer only uses it for "the rarest". */
const rarityBand = (pct: number | null) => (pct === null ? null : pct < 1 ? "<1" : pct < 5 ? "<5" : pct < 20 ? "<20" : ">=20");

/**
 * What the writing depends on, without what the site refreshes every day (rarity, critic score, time to beat:
 * coarse bands only) or what varies from run to run (the pages that could not be read).
 */
function stableInput(dossier: GuideDossier, game: GuideDossierSource["game"]) {
  const { unreadSources: _unread, ...rest } = dossier;
  return {
    dossier: { ...rest, achievements: rest.achievements.map((a) => ({ ...a, globalPct: rarityBand(a.globalPct) })) },
    game: {
      ...game,
      criticScore: game.criticScore === null ? null : Math.round(game.criticScore / 10),
      timeToBeatCompleteMin: game.timeToBeatCompleteMin === null ? null : Math.round(game.timeToBeatCompleteMin / 600),
    },
  };
}

export function writingKey(input: {
  dossier: GuideDossier;
  scope?: PsnWriteScope;
  game: GuideDossierSource["game"];
  models: GuideModels;
  version?: number;
}): string {
  const { dossier, game } = stableInput(input.dossier, input.game);
  // The skeleton's shape (its keys); what each item says is in the dossier already.
  const skel = buildSkeleton(input.dossier);
  const skeleton = {
    phases: skel.phases.map((p) => p.key),
    chapters: skel.chapters.map((c) => ({ key: c.key, steps: c.steps.map((s) => ({ key: s.key, items: s.items.map((i) => i.key) })) })),
    loose: skel.loose.map((l) => l.key),
  };
  const content = JSON.stringify({ dossier, scope: input.scope ?? null, skeleton, game });
  const parts = [`v${input.version ?? WRITER_CACHE_VERSION}`, sha(content), sha(loadGuideStyle()), input.models.MODEL_WRITER, input.models.MODEL_FAST];
  return `escrita:${sha(parts.join("|"))}`;
}

export function saveWriting(db: GuideDb, key: string, written: { payload: GuidePayloadV2; internalErrors?: string[] }, at: Date): void {
  const value: CachedWriting = { payload: written.payload, internalErrors: written.internalErrors ?? [], savedAt: at.toISOString() };
  db.setMeta(key, JSON.stringify(value));
}

/** The cached writing (a fresh copy), or undefined when there is none or it cannot be read. */
export function readWriting(db: GuideDb, key: string): CachedWriting | undefined {
  const raw = db.getMeta(key);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<CachedWriting>;
    if (value.payload?.format !== 2 || !Array.isArray(value.payload.walkthrough?.chapters)) return undefined;
    return { payload: value.payload, internalErrors: Array.isArray(value.internalErrors) ? value.internalErrors : [], savedAt: String(value.savedAt ?? "") };
  } catch {
    return undefined;
  }
}
