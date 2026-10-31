import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "../../../prisma/seed-data/blocks";
import { ARTICLES } from "../../../prisma/seed-data/news";
import {
  blocksExcerpt,
  contentBlocksSchema,
  parseStoredBlocks,
  stripInline,
} from "./schema";

const parse = (blocks: unknown) => contentBlocksSchema.safeParse(blocks);
const paths = (blocks: unknown) => {
  const result = parse(blocks);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("/"));
};

describe("contentBlocksSchema", () => {
  it("accepts every block type", () => {
    const result = parse([
      { type: "heading", level: 2, text: "Rota" },
      { type: "paragraph", text: "Texto **forte**, *leve* e [fonte](https://example.com/a)." },
      { type: "list", ordered: true, items: ["Um", "Dois"] },
      { type: "quote", text: "Vale cada tentativa.", author: "@Cacador_Joaquim" },
      { type: "image", url: "https://cdn.example.com/a.webp", alt: "Mapa", credit: "Team Cherry" },
      { type: "video", youtubeId: "dQw4w9WgXcQ" },
      { type: "callout", tone: "spoiler", text: "O chefe final volta." },
      { type: "table", header: ["Etapa", "Horas"], rows: [["1", "4"], ["2", "6"]] },
      { type: "achievement", apiName: "ACH_PANTHEON" },
      { type: "divider" },
    ]);
    expect(result.success).toBe(true);
    // achievement.platform defaults to steam
    expect(result.data?.[8]).toEqual({ type: "achievement", apiName: "ACH_PANTHEON", platform: "steam" });
  });

  it("accepts the blocks the seed writes for every article", () => {
    for (const article of ARTICLES) {
      expect(parse(markdownToBlocks(article.body)).success, article.slug).toBe(true);
    }
  });

  it("rejects raw HTML in any text field", () => {
    expect(paths([{ type: "paragraph", text: "Olá <script>alert(1)</script>" }])).toEqual(["0/text"]);
    expect(paths([{ type: "heading", level: 2, text: "<b>Título</b>" }])).toEqual(["0/text"]);
    expect(paths([{ type: "list", ordered: false, items: ["ok", '<img src=x onerror="x">'] }])).toEqual([
      "0/items/1",
    ]);
    expect(paths([{ type: "quote", text: "<!-- x -->" }])).toEqual(["0/text"]);
    // A comparison is not a tag.
    expect(parse([{ type: "paragraph", text: "Se a < b e b > c" }]).success).toBe(true);
  });

  it("rejects javascript: links and non-https images", () => {
    expect(paths([{ type: "paragraph", text: "[clique](javascript:alert(1))" }])).toContain("0/text");
    expect(paths([{ type: "paragraph", text: "[x](ftp://example.com)" }])).toEqual(["0/text"]);
    expect(paths([{ type: "image", url: "javascript:alert(1)", alt: "a", credit: "b" }])).toEqual(["0/url"]);
    expect(paths([{ type: "image", url: "http://example.com/a.png", alt: "a", credit: "b" }])).toEqual([
      "0/url",
    ]);
  });

  it("rejects images without alt or credit", () => {
    expect(paths([{ type: "image", url: "https://example.com/a.png", credit: "b" }])).toEqual(["0/alt"]);
    expect(paths([{ type: "image", url: "https://example.com/a.png", alt: " ", credit: "b" }])).toEqual([
      "0/alt",
    ]);
    expect(paths([{ type: "image", url: "https://example.com/a.png", alt: "a" }])).toEqual(["0/credit"]);
  });

  it("rejects C0 control characters with the field path, but keeps tab and line feed", () => {
    expect(paths([{ type: "paragraph", text: "nul\u0000byte" }])).toEqual(["0/text"]);
    expect(paths([{ type: "heading", level: 2, text: "bell\u0007" }])).toEqual(["0/text"]);
    expect(paths([{ type: "list", ordered: false, items: ["ok", "esc\u001b[31m"] }])).toEqual(["0/items/1"]);
    expect(paths([{ type: "table", header: ["a"], rows: [["x\u000bY"]] }])).toEqual(["0/rows/0/0"]);
    expect(paths([{ type: "image", url: "https://example.com/a.png", alt: "a", credit: "c\r" }])).toEqual([]);
    expect(paths([{ type: "image", url: "https://example.com/a.png", alt: "a\u0001b", credit: "c" }])).toEqual([
      "0/alt",
    ]);
    expect(paths([{ type: "achievement", apiName: "ACH\u0000" }])).toEqual(["0/apiName"]);
    expect(parse([{ type: "paragraph", text: "linha 1\nlinha 2\tcom tab" }]).success).toBe(true);
  });

  it("accepts ordinary text mentioning data:, but not data: link or image targets", () => {
    expect(parse([{ type: "paragraph", text: "Antes de tudo, save data: faça backup." }]).success).toBe(true);
    expect(paths([{ type: "paragraph", text: "[x](data:text/html,<b>)" }])).toContain("0/text");
    expect(paths([{ type: "paragraph", text: "[x](data:text/plain,oi)" }])).toEqual(["0/text"]);
    expect(paths([{ type: "image", url: "data:image/png;base64,AAAA", alt: "a", credit: "b" }])).toEqual(["0/url"]);
    expect(paths([{ type: "paragraph", text: "[x](//evil.example.com)" }])).toEqual(["0/text"]);
    expect(paths([{ type: "paragraph", text: "nada de JavaScript : alert" }])).toEqual(["0/text"]);
  });

  it("is strict: unknown keys and types fail", () => {
    expect(parse([{ type: "paragraph", text: "a", html: "<b>" }]).success).toBe(false);
    expect(parse([{ type: "embed", src: "https://x" }]).success).toBe(false);
    expect(parse([{ type: "heading", level: 1, text: "H1" }]).success).toBe(false);
    expect(parse([{ type: "video", youtubeId: "https://youtu.be/x" }]).success).toBe(false);
    expect(parse([{ type: "achievement", apiName: "A", platform: "stadia" }]).success).toBe(false);
  });

  it("limits tables to 8 columns and rows to the header width", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `c${i}`);
    expect(parse([{ type: "table", header: nine, rows: [nine] }]).success).toBe(false);
    expect(paths([{ type: "table", header: ["a", "b"], rows: [["1", "2"], ["3"]] }])).toEqual(["0/rows/1"]);
  });
});

describe("helpers", () => {
  it("parseStoredBlocks returns null for invalid JSON blocks", () => {
    expect(parseStoredBlocks([{ type: "paragraph", text: "ok" }])).toHaveLength(1);
    expect(parseStoredBlocks({ nope: true })).toBeNull();
    expect(parseStoredBlocks([])).toEqual([]);
  });

  it("blocksExcerpt uses the first paragraph without markup", () => {
    expect(
      blocksExcerpt([
        { type: "heading", level: 2, text: "H" },
        { type: "paragraph", text: "Leia **isto** e [aquilo](https://example.com)." },
      ]),
    ).toBe("Leia isto e aquilo.");
    expect(blocksExcerpt([{ type: "divider" }])).toBeNull();
    expect(stripInline("*a*  **b**")).toBe("a b");
    expect(blocksExcerpt([{ type: "paragraph", text: "palavra ".repeat(50) }], 40)?.endsWith("…")).toBe(true);
  });
});
