/** Deepest nesting of arrays/objects a bot request body may have. Real payloads stay under 10. */
export const MAX_JSON_DEPTH = 64;

/**
 * True when the JSON text nests arrays/objects deeper than `max`. One linear pass over the raw
 * text, skipping string contents, run before JSON.parse so that no recursive step (line-ending
 * normalization, hashing, zod) ever sees a pathologically deep value and overflows the stack.
 */
export function jsonDepthExceeds(text: string, max: number = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c /* \ */) i++;
      else if (c === 0x22 /* " */) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
      if (++depth > max) return true;
    } else if (c === 0x7d /* } */ || c === 0x5d /* ] */) depth--;
  }
  return false;
}
