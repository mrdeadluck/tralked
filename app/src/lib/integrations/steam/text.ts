const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The character of a numeric entity; an invalid code point (`&#99999999;`) yields nothing. */
function fromCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Decodes named (`&amp;`) and numeric (`&#39;`, `&#x27;`) entities; unknown names stay as they are. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      return fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}
