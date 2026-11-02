import { z } from "zod";
import { containsHtml, HTML_MESSAGE } from "@/lib/community/text";
import { isSetupPlatformId, orderPlatformIds, PC_FIELDS, SETUP_PLATFORMS, SPEC_MAX, type PcFieldKey, type PcSpecs } from "./catalog";

/** Raw input guard before cleanup, so a huge payload is refused without being processed. */
const SPEC_INPUT_MAX = 500;

/**
 * One-line plain text: Unicode NFC; control characters (line breaks, tabs) become spaces;
 * invisible format characters (zero-width, bidi overrides) are removed; runs of spaces collapse.
 */
export function cleanSpecText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function specField(label: string) {
  return z
    .string({ error: `${label}: escreva só texto.` })
    .max(SPEC_INPUT_MAX, `${label}: no máximo ${SPEC_MAX} caracteres.`)
    .transform(cleanSpecText)
    .pipe(
      z
        .string()
        .max(SPEC_MAX, `${label}: no máximo ${SPEC_MAX} caracteres.`)
        .refine((value) => !containsHtml(value), `${label}: ${HTML_MESSAGE}`),
    )
    .optional();
}

const pcShape = Object.fromEntries(PC_FIELDS.map((field) => [field.key, specField(field.label)])) as Record<
  PcFieldKey,
  ReturnType<typeof specField>
>;

/** Filled fields only, in PC_FIELDS order; null when nothing is filled. */
function compactSpecs(values: Partial<Record<PcFieldKey, string | undefined>>): PcSpecs | null {
  const specs: PcSpecs = {};
  for (const { key } of PC_FIELDS) {
    const value = values[key];
    if (value) specs[key] = value;
  }
  return Object.keys(specs).length > 0 ? specs : null;
}

/** The settings form's payload: platform ids and the spec sheet (every field optional). */
export const playerSetupSchema = z
  .object({
    platforms: z
      .array(z.string().max(40), { error: "Lista de plataformas inválida." })
      .max(SETUP_PLATFORMS.length, "Lista de plataformas inválida.")
      .refine((ids) => ids.every(isSetupPlatformId), "Uma das plataformas não existe na lista.")
      .transform(orderPlatformIds),
    pc: z
      .strictObject(pcShape, { error: "Ficha técnica inválida." })
      .nullable()
      .transform((values) => (values ? compactSpecs(values) : null)),
  })
  .strict();

export type PlayerSetupInput = z.output<typeof playerSetupSchema>;

/**
 * The stored spec sheet read back: unknown keys and invalid values are dropped (the column is
 * JSON, so a value written by an older or newer version must never break the profile).
 */
export function readPcSpecs(value: unknown): PcSpecs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const values: Partial<Record<PcFieldKey, string>> = {};
  for (const { key, label } of PC_FIELDS) {
    const parsed = specField(label).safeParse(record[key]);
    if (parsed.success && parsed.data) values[key] = parsed.data;
  }
  return compactSpecs(values);
}

/** The field a validation issue points at ("platforms", "pc.gpu"), for focusing it in the form. */
export function issueField(error: z.ZodError): string | undefined {
  const path = error.issues[0]?.path;
  return path && path.length > 0 ? path.map(String).join(".") : undefined;
}
