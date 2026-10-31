import { z } from "zod";
import { zodIssues } from "./errors";
import { fail, type WriteFailure } from "./write";

/** zod's built-in messages in Portuguese; messages written in the schemas win over these. */
const ptBR = z.locales.pt().localeError;

/** Validates a request body; a failure is a 422 with one issue per field (JSON Pointer paths). */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): { ok: true; data: z.output<S> } | WriteFailure {
  const result = schema.safeParse(body, { error: ptBR });
  if (result.success) return { ok: true, data: result.data };
  return fail("validation_failed", "O corpo tem campos inválidos; veja issues.", zodIssues(result.error));
}
