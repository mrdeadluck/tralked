/**
 * How the browser names a walkthrough item. Item keys are readable ("boss-hua-noiva-mortal"), so an
 * item behind the spoiler gate travels as an opaque ref instead ("~" + hash of its key; "~" is never
 * in a key): the page never spells a spoiler, and the server maps the ref back to the key
 * (toggleItem, the user's marks). Every other item travels as its key.
 */

/** FNV-1a over the key with a given offset basis: 8 hex chars. */
function fnv(text: string, basis: number): string {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Opaque ref of a gated item (stable for a given key). */
export function gatedRef(key: string): string {
  return `~${fnv(key, 0x811c9dc5)}${fnv(key, 0x2f4a7c15)}`;
}

/** The ref the browser uses for an item: its key, or the opaque ref while it is gated. */
export function itemRef(key: string, gated: boolean): string {
  return gated ? gatedRef(key) : key;
}

/** Item key a browser ref points at, among `keys` (null when none matches). */
export function keyOfRef(ref: string, keys: readonly string[]): string | null {
  if (ref.startsWith("~")) return keys.find((key) => gatedRef(key) === ref) ?? null;
  return keys.includes(ref) ? ref : null;
}
