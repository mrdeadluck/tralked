import sharp from "sharp";
import { z } from "zod";
import type { Ai } from "../ai/client.js";

/** Same default as `MODEL_FAST` in the guide config. */
const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_SIDE = 1280;

export type Target = { x: number; y: number; r: number };

const locateSchema = z.object({
  found: z.boolean(),
  x: z.number(),
  y: z.number(),
  r: z.number(),
});

const SYSTEM =
  "You locate one thing in a game screenshot or map for a guide. Reply with the center of the target as " +
  "fractions of the image (x from left, y from top, both 0 to 1) and a radius r as a fraction of the image width " +
  "that comfortably encloses the target. If the target is not clearly visible, or you are not sure which spot it " +
  "is, set found to false. Never guess.";

/** Asks a vision model where the item is; `null` when it is not clearly there (the image then gets no ring). */
export async function locateTarget(
  ai: Ai,
  imageBytes: Buffer,
  itemName: string,
  opts: { model?: string; bucket?: "live" | "backfill" } = {},
): Promise<Target | null> {
  const small = await sharp(imageBytes)
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const out = await ai.structured({
    bucket: opts.bucket ?? "backfill",
    purpose: "guia-locate",
    model: opts.model ?? DEFAULT_MODEL,
    effort: "low",
    system: SYSTEM,
    user: `Where is "${itemName}" in this image?`,
    images: [{ mediaType: "image/jpeg", data: small }],
    schema: locateSchema,
    // 300 cut 64 of 509 PBZ answers short (stop_reason max_tokens): the model thinks a little even at effort low.
    maxTokens: 1024,
  });
  if (!out.found) return null;
  const { x, y, r } = out;
  if (![x, y, r].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1 || r <= 0 || r > 0.5) return null;
  return { x, y, r };
}
