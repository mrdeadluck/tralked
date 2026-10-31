/**
 * ContentBlock[] shape stored in Article.blocks / Guide.blocks (spec Plan 2, "Formato de conteúdo
 * único em blocos"). The validating zod schema and the renderer live in src/lib/content (Task 6);
 * this seed-side type mirrors that shape so the seed can write blocks without depending on it.
 * Paragraph/list/quote/callout text may carry restricted inline markup only: **bold**, *italic*
 * and [links](https://…). No raw HTML anywhere.
 */
export type ContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; author?: string }
  | { type: "image"; url: string; alt: string; credit: string }
  | { type: "video"; youtubeId: string }
  | { type: "callout"; tone: "info" | "aviso" | "spoiler"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "achievement"; apiName: string }
  | { type: "divider" };

const ORDERED_ITEM = /^\d+\.\s+/;
const UNORDERED_ITEM = /^[-*]\s+/;

/**
 * Converts the seed's simple Markdown bodies (blank-line separated blocks: `##`/`###` headings,
 * `-`/`1.` lists, `>` quotes, `---` dividers, paragraphs) into ContentBlock[].
 */
export function markdownToBlocks(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const chunk of markdown.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const first = lines[0];
    const heading = /^(#{2,3})\s+(.*)$/.exec(first);
    if (heading && lines.length === 1) {
      blocks.push({ type: "heading", level: heading[1].length as 2 | 3, text: heading[2] });
    } else if (/^-{3,}$/.test(first) && lines.length === 1) {
      blocks.push({ type: "divider" });
    } else if (lines.every((l) => UNORDERED_ITEM.test(l))) {
      blocks.push({ type: "list", ordered: false, items: lines.map((l) => l.replace(UNORDERED_ITEM, "")) });
    } else if (lines.every((l) => ORDERED_ITEM.test(l))) {
      blocks.push({ type: "list", ordered: true, items: lines.map((l) => l.replace(ORDERED_ITEM, "")) });
    } else if (lines.every((l) => l.startsWith(">"))) {
      blocks.push({ type: "quote", text: lines.map((l) => l.replace(/^>\s?/, "")).join(" ") });
    } else {
      blocks.push({ type: "paragraph", text: lines.join(" ") });
    }
  }
  return blocks;
}
