import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/lib/content/schema";
import { withHuntCallout } from "./hunt-callout";

const blocks: ContentBlock[] = [
  { type: "paragraph", text: "Texto." },
  { type: "callout", tone: "info", text: "**Pra quem joga de boa:** sai em 2027." },
  { type: "callout", tone: "info", text: "**Pra quem caça 100%:** Ainda não há conquistas nem troféus cadastrados para o jogo no Tralked." },
];

const game = { slug: "re", name: "Resident Evil Veronica", hasGuide: false, coverUrl: null };

describe("withHuntCallout", () => {
  it("drops the hunt callout while the game has no achievements", () => {
    expect(withHuntCallout(blocks, { ...game, achievementCount: 0 })).toEqual(blocks.slice(0, 2));
    expect(withHuntCallout(blocks, null)).toEqual(blocks.slice(0, 2));
  });

  it("tells the real count, the platinum and the guide when the catalog has them", () => {
    const out = withHuntCallout(blocks, { ...game, achievementCount: 52, hasPlatinum: true, hasGuide: true });
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      type: "callout",
      tone: "info",
      text: "**Pra quem caça 100%:** Resident Evil Veronica tem 52 conquistas no Tralked, com platina no PlayStation. O guia 100% já está no ar.",
    });
    // Other callouts are left alone.
    expect(out[1]).toBe(blocks[1]);
  });
});
