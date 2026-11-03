import { z } from "zod";
import { SOURCE_ROLES } from "./sources.js";

export const sourceRefSchema = z.object({
  name: z.string(),
  url: z.string(),
  role: z.enum(SOURCE_ROLES),
  language: z.string().optional(),
});

const itemSchema = z.object({
  kind: z.string(),
  name: z.string(),
  nameEn: z.string().optional(),
  collectibleType: z.string().optional(),
  index: z.number().optional(),
  total: z.number().optional(),
  location: z.string(),
  missable: z.boolean(),
  missableUntil: z.string().optional(),
  returnLater: z.boolean(),
  achievementNameEn: z.string().optional(),
  countsForEn: z.array(z.string()),
});

const chapterSchema = z.object({
  title: z.string(),
  region: z.string().optional(),
  order: z.number(),
  items: z.array(itemSchema),
});

const achievementSchema = z.object({
  nameEn: z.string(),
  howTo: z.string(),
  missable: z.boolean(),
  missableUntil: z.string().optional(),
  bugged: z.boolean(),
  bugNote: z.string().optional(),
  online: z.boolean(),
});

/** What the model fills in; `source` is attached by the code, never by the model. */
export const llmFactsSchema = z.object({
  chapters: z.array(chapterSchema),
  achievements: z.array(achievementSchema),
  playthroughs: z.object({ min: z.number(), note: z.string() }).optional(),
  difficulty: z.object({ value: z.number(), note: z.string() }).optional(),
  hours: z.object({ min: z.number(), max: z.number() }).optional(),
  roadmap: z.array(z.object({ title: z.string(), summary: z.string() })).optional(),
  trophyListSize: z.number().optional(),
  platform: z.enum(["psn", "steam", "unknown"]),
  /** This part of the page presents the guide as covering every trophy/achievement of the game. */
  claimsComplete: z.boolean(),
  /** This part of the page says the guide is unfinished (WIP, still being written). */
  workInProgress: z.boolean(),
});

/**
 * The facts of a whole page. `complete` joins the parts: some part claims 100% and no part says it is a work in
 * progress (`mergeComplete` in extract.ts).
 */
export const extractedFactsSchema = llmFactsSchema
  .omit({ claimsComplete: true, workInProgress: true })
  .extend({ source: sourceRefSchema, complete: z.boolean() });

export type LlmFacts = z.infer<typeof llmFactsSchema>;
export type ExtractedFacts = z.infer<typeof extractedFactsSchema>;
