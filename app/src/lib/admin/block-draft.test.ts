import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/lib/content/schema";
import { blockFromDraft, draftFromBlock, emptyDraft, moveDraft, validateDrafts, youtubeIdFrom } from "./block-draft";

const EVERY_BLOCK: ContentBlock[] = [
  { type: "heading", level: 3, text: "Seção" },
  { type: "paragraph", text: "Texto com **negrito** e [link](https://exemplo.com)." },
  { type: "list", ordered: true, items: ["um", "dois"] },
  { type: "quote", text: "Frase.", author: "Alguém" },
  { type: "image", url: "https://exemplo.com/a.png", alt: "Uma tela", credit: "Estúdio" },
  { type: "video", youtubeId: "dQw4w9WgXcQ" },
  { type: "callout", tone: "spoiler", text: "Cuidado." },
  { type: "table", header: ["Chefe", "Dica"], rows: [["Hornet", "Pule"], ["Mantis", "Paciência"]] },
  { type: "achievement", apiName: "ACH_1", platform: "psn" },
  { type: "divider" },
];

describe("block drafts", () => {
  it("round-trips every block type through the editor's form strings", () => {
    const drafts = EVERY_BLOCK.map(draftFromBlock);
    expect(drafts.map(blockFromDraft)).toEqual(EVERY_BLOCK);
    expect(validateDrafts(drafts).blocks).toEqual(EVERY_BLOCK);
  });

  it("leaves an empty quote author out and splits list lines and table cells", () => {
    expect(blockFromDraft({ ...emptyDraft("quote"), text: "Oi", author: "  " })).toEqual({ type: "quote", text: "Oi" });
    expect(blockFromDraft({ ...emptyDraft("list"), text: "a\n\n b \n" })).toEqual({ type: "list", ordered: false, items: ["a", "b"] });
    expect(blockFromDraft({ ...emptyDraft("table"), header: "A | B", text: "1 | 2\n3|4" })).toEqual({
      type: "table",
      header: ["A", "B"],
      rows: [["1", "2"], ["3", "4"]],
    });
  });

  it("accepts YouTube links as well as ids", () => {
    expect(youtubeIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFrom("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFrom("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFrom("https://evil.com/watch?v=dQw4w9WgXcQ")).toBe("https://evil.com/watch?v=dQw4w9WgXcQ");
  });

  it("reports problems per block with the site's own rules", () => {
    const check = validateDrafts([
      { ...emptyDraft("paragraph"), text: "ok" },
      { ...emptyDraft("paragraph"), text: "<b>html</b>" },
      { ...emptyDraft("image"), url: "http://exemplo.com/a.png", alt: "a", author: "b" },
      { ...emptyDraft("table"), header: "A | B", text: "só uma" },
    ]);
    expect(check.blocks).toBeNull();
    expect(check.results[0].ok).toBe(true);
    expect(check.results[1]).toEqual({ ok: false, issues: ["Texto: HTML não é permitido; use texto puro"] });
    expect(check.results[2]).toMatchObject({ ok: false, issues: [expect.stringMatching(/^URL: /)] });
    expect(check.results[3]).toMatchObject({ ok: false, issues: [expect.stringMatching(/^Linhas 1: .*1 colunas/)] });
  });

  it("moves an item and ignores moves past the ends", () => {
    expect(moveDraft(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveDraft(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    const same = ["a", "b"];
    expect(moveDraft(same, 0, -1)).toBe(same);
    expect(moveDraft(same, 1, 1)).toBe(same);
  });
});
