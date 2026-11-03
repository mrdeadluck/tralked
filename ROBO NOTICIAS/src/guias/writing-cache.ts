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
 * skeleton or the guide contract change: a writing cached by older code must not be reused. v7: the guide voice v2
 * (2026-11-03: new manual, no code callout per missable step, the doubt-phrase ban, the checker's new defects).
 */
export const WRITER_CACHE_VERSION = 7;

/**
 * Voice v2: the oldest writer version whose drafts may be carried to another writing key (drafts.ts `carriedDraft`).
 * Texts written in the older voice ("confira no jogo", the code's per-step callout) are never a starting point: the
 * v7 bump is a full rewrite. Raise it with the version when a change must not reuse any earlier text.
 */
export const MIN_CARRIED_VERSION = 7;

/**
 * Task 21: the writer versions before drafts kept their base key (`writingBaseKey`), with the sha256 of the style
 * manual (guia-estilo.md) they read, as checked out on Windows (CRLF, where the probe of 2026-11-03 ran) and as the
 * repository stores it (LF). Their drafts are found by the key they were saved under (`earlierDraftKeys`).
 */
const EARLIER_WRITERS = [
  // v4 hashed MODEL_FAST, which was the checker's model then (Haiku), and no effort.
  { version: 4, styleSha: "9370203988e171c3c078769785708c0614a01a7358a59b43e6901af10d259bd4", checker: ["claude-haiku-5-5"] },
  { version: 4, styleSha: "31ede8b4f00a4cbb5b4c963ad897211fa7cdc2f0c7ac181b853442ec322ed058", checker: ["claude-haiku-5-5"] },
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

const keyOf = (version: number, inputs: WritingInputs, styleSha: string, checker: string[]) =>
  `escrita:${sha([`v${version}`, sha(inputsOf(inputs)), styleSha, inputs.models.MODEL_WRITER, ...checker].join("|"))}`;

/**
 * The approved writing's key: the inputs, the writer's version, manual and model, and the checker that approved it
 * (Task 22: its model and effort).
 */
export function writingKey(input: WritingInputs & { version?: number }): string {
  return keyOf(input.version ?? WRITER_CACHE_VERSION, input, sha(loadGuideStyle()), [input.models.MODEL_CHECK, input.models.CHECK_EFFORT]);
}

/**
 * Task 21: the same inputs without the writer's version and manual. A draft keeps it: after a version bump (or a new
 * manual), the texts its checker accepted are still a starting point (drafts.ts `carriedDraft`). Task 22: only the
 * writer's model, never the checker's: a new checker checks the carried texts again (`checagem-devida`).
 */
export function writingBaseKey(input: WritingInputs): string {
  return `base:${sha([sha(inputsOf(input)), input.models.MODEL_WRITER].join("|"))}`;
}

/**
 * Task 22: the base keys of drafts saved before the checker left it (v5 at d2f7bc2 hashed MODEL_FAST, the checker's
 * model then: Haiku). The probe of 2026-11-03 (direto-4115450, attempt 3) was saved under it.
 */
const EARLIER_BASE_CHECKERS = ["claude-haiku-5-5"];

export function earlierBaseKeys(input: WritingInputs): string[] {
  return EARLIER_BASE_CHECKERS.map((checker) => `base:${sha([sha(inputsOf(input)), input.models.MODEL_WRITER, checker].join("|"))}`);
}

/** The keys the earlier writers (`EARLIER_WRITERS`) gave these inputs: their drafts have no base key. */
export function earlierDraftKeys(input: WritingInputs): string[] {
  return EARLIER_WRITERS.map((w) => keyOf(w.version, input, w.styleSha, w.checker));
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
