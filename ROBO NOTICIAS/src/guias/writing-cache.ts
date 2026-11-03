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

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function writingKey(input: { dossier: GuideDossier; scope?: PsnWriteScope; game: GuideDossierSource["game"]; models: GuideModels }): string {
  const { unreadSources: _unread, ...dossier } = input.dossier;
  const content = JSON.stringify({ dossier, scope: input.scope ?? null, skeleton: buildSkeleton(input.dossier), game: input.game });
  return `escrita:${sha([sha(content), sha(loadGuideStyle()), input.models.MODEL_WRITER, input.models.MODEL_FAST].join("\n"))}`;
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
