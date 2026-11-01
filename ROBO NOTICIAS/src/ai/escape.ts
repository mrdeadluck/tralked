/** Escaping for text placed inside the prompts' pseudo-XML tags, so outside text cannot open or close a tag. */

/** For an attribute value inside double quotes. */
export const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** For element content: source bodies, headlines, names and data. */
export const escapeText = (value: string) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
