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
export const WRITER_CACHE_VERSION = 5;

/**
 * Task 21: the writer versions before drafts kept their base key (`writingBaseKey`), with the sha256 of the style
 * manual (guia-estilo.md) they read, as checked out on Windows (CRLF, where the probe of 2026-11-03 ran) and as the
 * repository stores it (LF). Their drafts are found by the key they were saved under (`earlierDraftKeys`).
 */
const EARLIER_WRITERS = [
  { version: 4, styleSha: "9370203988e171c3c078769785708c0614a01a7358a59b43e6901af10d259bd4" },
  { version: 4, styleSha: "31ede8b4f00a4cbb5b4c963ad897211fa7cdc2f0c7ac181b853442ec322ed058" },
];

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

type WritingInputs = { dossier: GuideDossier; scope?: PsnWriteScope; game: GuideDossierSource["game"]; models: GuideModels };

/** What the writing is written from: the stable dossier, the scope, the skeleton's shape and the game (JSON). */
function inputsOf(input: WritingInputs): string {
  const { dossier, game } = stableInput(input.dossier, input.game);
  // The skeleton's shape (its keys); what each item says is in the dossier already.
  const skel = buildSkeleton(input.dossier);
  const skeleton = {
    phases: skel.phases.map((p) => p.key),
    chapters: skel.chapters.map((c) => ({ key: c.key, steps: c.steps.map((s) => ({ key: s.key, items: s.items.map((i) => i.key) })) })),
    loose: skel.loose.map((l) => l.key),
  };
  return JSON.stringify({ dossier, scope: input.scope ?? null, skeleton, game });
}

/** `styleSha`: the manual's hash (the current one by default; an earlier writer's to find its drafts). */
export function writingKey(input: WritingInputs & { version?: number; styleSha?: string }): string {
  const parts = [
    `v${input.version ?? WRITER_CACHE_VERSION}`,
    sha(inputsOf(input)),
    input.styleSha ?? sha(loadGuideStyle()),
    input.models.MODEL_WRITER,
    input.models.MODEL_FAST,
  ];
  return `escrita:${sha(parts.join("|"))}`;
}

/**
 * Task 21: the same inputs without the writer's version and manual. A draft keeps it: after a version bump (or a new
 * manual), the texts its checker accepted are still a starting point (drafts.ts `carriedDraft`).
 */
export function writingBaseKey(input: WritingInputs): string {
  return `base:${sha([sha(inputsOf(input)), input.models.MODEL_WRITER, input.models.MODEL_FAST].join("|"))}`;
}

/** The keys the earlier writers (`EARLIER_WRITERS`) gave these inputs: their drafts have no base key. */
export function earlierDraftKeys(input: WritingInputs): string[] {
  return EARLIER_WRITERS.map((w) => writingKey({ ...input, version: w.version, styleSha: w.styleSha }));
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
