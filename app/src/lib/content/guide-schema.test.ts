import { describe, expect, it } from "vitest";
import { EXAMPLE_GUIDE } from "@/lib/api/examples";
import {
  blocksToPlainText,
  gameRefSchema,
  guidePatchSchema,
  guidePayloadSchema,
} from "./guide-schema";

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join("/")) ?? [];

describe("guide payload", () => {
  it("accepts the documented example and fills defaults", () => {
    const guide = guidePayloadSchema.parse({ ...EXAMPLE_GUIDE, achievementNotes: undefined, sources: undefined });
    expect(guide.achievementNotes).toEqual([]);
    expect(guide.sources).toEqual([]);
    expect(guidePayloadSchema.parse(EXAMPLE_GUIDE).achievementNotes[0].platform).toBe("steam");
  });

  it("wants exactly one game id", () => {
    expect(gameRefSchema.safeParse({ slug: "hades" }).success).toBe(true);
    expect(gameRefSchema.safeParse({ steamAppId: 620 }).success).toBe(true);
    expect(gameRefSchema.safeParse({}).success).toBe(false);
    expect(gameRefSchema.safeParse({ slug: "hades", steamAppId: 620 }).success).toBe(false);
    expect(gameRefSchema.safeParse({ slug: "Hades Game" }).success).toBe(false);
  });

  it("refuses HTML, script URLs and http images inside steps and tips, by path", () => {
    const bad = structuredClone(EXAMPLE_GUIDE) as unknown as {
      steps: { body: unknown[] }[];
      achievementNotes: { tip: unknown[] }[];
      overview: string[];
    };
    bad.steps[0].body = [{ type: "paragraph", text: "<script>alert(1)</script>" }];
    bad.steps[1].body = [{ type: "image", url: "http://x.com/a.jpg", alt: "a", credit: "b" }];
    bad.achievementNotes[0].tip = [{ type: "paragraph", text: "[clique](javascript:alert(1))" }];
    bad.overview = ["<b>forte</b>"];
    const result = guidePayloadSchema.safeParse(bad);
    expect(paths(result)).toEqual(
      expect.arrayContaining([
        "steps/0/body/0/text",
        "steps/1/body/0/url",
        "achievementNotes/0/tip/0/text",
        "overview/0",
      ]),
    );
  });

  it("checks hours and repeated achievements", () => {
    const result = guidePayloadSchema.safeParse({
      ...EXAMPLE_GUIDE,
      facts: { ...EXAMPLE_GUIDE.facts, hoursMin: 50, hoursMax: 10 },
      achievementNotes: [EXAMPLE_GUIDE.achievementNotes[0], EXAMPLE_GUIDE.achievementNotes[0]],
    });
    expect(paths(result)).toEqual(expect.arrayContaining(["facts/hoursMax", "achievementNotes/1/apiName"]));
  });

  it("a patch needs at least one field and has no defaults", () => {
    expect(guidePatchSchema.safeParse({}).success).toBe(false);
    expect(guidePatchSchema.parse({ warnings: [] })).toEqual({ warnings: [] });
    expect(guidePatchSchema.safeParse({ game: { slug: "hades" } }).success).toBe(false);
  });
});

describe("blocksToPlainText", () => {
  it("keeps the words and drops markup and media", () => {
    expect(
      blocksToPlainText([
        { type: "heading", level: 2, text: "Título" },
        { type: "paragraph", text: "Use **o escudo** e [veja](https://a.com)." },
        { type: "image", url: "https://a.com/x.jpg", alt: "a", credit: "b" },
        { type: "list", ordered: true, items: ["um", "*dois*"] },
        { type: "callout", tone: "aviso", text: "Cuidado" },
      ]),
    ).toBe("Título Use o escudo e veja. um; dois Cuidado");
  });
});
