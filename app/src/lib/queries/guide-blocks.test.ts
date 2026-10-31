import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// Rich step bodies / tips (bot guides) and the guide's sources, on the seeded Hollow Knight guide.
const { prisma } = await import("@/lib/db");
const { getGuidePublic, parseGuideSources } = await import("./games");

type Saved = {
  guideId: string;
  sources: unknown;
  stepBlocks: Map<string, unknown>;
  note: { id: string; tipBlocks: unknown };
};
let saved: Saved;

beforeAll(async () => {
  const guide = await prisma.guide.findFirstOrThrow({
    where: { game: { slug: "hollow-knight" } },
    include: { steps: { orderBy: { order: "asc" }, take: 2 }, notes: { take: 1, include: { achievement: true } } },
  });
  const [step, plainStep] = guide.steps;
  const note = guide.notes[0];
  saved = {
    guideId: guide.id,
    sources: guide.sources,
    stepBlocks: new Map(guide.steps.map((s) => [s.id, s.blocks])),
    note: { id: note.id, tipBlocks: note.tipBlocks },
  };
  await prisma.guideStep.update({ where: { id: plainStep.id }, data: { blocks: [] } });
  await prisma.guideStep.update({
    where: { id: step.id },
    data: {
      blocks: [
        { type: "paragraph", text: "Vá até **Dirtmouth** e fale com o Elderbug." },
        { type: "achievement", platform: "steam", apiName: note.achievement.apiName },
      ],
    },
  });
  await prisma.guideAchievementNote.update({
    where: { id: note.id },
    data: { tipBlocks: [{ type: "callout", tone: "aviso", text: "Salve antes do chefe." }] },
  });
  await prisma.guide.update({
    where: { id: guide.id },
    data: {
      sources: [
        { title: "Wiki oficial", url: "https://hollowknight.wiki/w/Achievements" },
        { title: "Link ruim", url: "javascript:alert(1)" },
        { title: "", url: "https://exemplo.com" },
        "lixo",
      ],
    },
  });
});

afterAll(async () => {
  const json = (value: unknown) => (value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue));
  for (const [id, blocks] of saved.stepBlocks) {
    await prisma.guideStep.update({ where: { id }, data: { blocks: json(blocks) } });
  }
  await prisma.guideAchievementNote.update({ where: { id: saved.note.id }, data: { tipBlocks: json(saved.note.tipBlocks) } });
  await prisma.guide.update({ where: { id: saved.guideId }, data: { sources: saved.sources as Prisma.InputJsonValue } });
});

describe("guide blocks and sources", () => {
  it("returns rich step bodies with their achievement cards; empty blocks fall back to plain text", async () => {
    const guide = await getGuidePublic("hollow-knight");
    const [first, second] = guide!.steps;
    expect(first.blocks?.map((b) => b.type)).toEqual(["paragraph", "achievement"]);
    expect(Object.values(first.cards)).toEqual([
      expect.objectContaining({ name: expect.any(String), gameName: "Hollow Knight" }),
    ]);
    expect(first.body.length).toBeGreaterThan(0);
    expect(second.blocks).toBeNull();
  });

  it("returns rich tips", async () => {
    const guide = await getGuidePublic("hollow-knight");
    const rich = guide!.achievements.find((a) => a.tipBlocks !== null);
    expect(rich?.tipBlocks).toEqual([{ type: "callout", tone: "aviso", text: "Salve antes do chefe." }]);
    expect(guide!.achievements.filter((a) => a.tipBlocks !== null)).toHaveLength(1);
  });

  it("keeps only valid http(s) sources", async () => {
    const guide = await getGuidePublic("hollow-knight");
    expect(guide!.sources).toEqual([{ title: "Wiki oficial", url: "https://hollowknight.wiki/w/Achievements" }]);
    expect(parseGuideSources(null)).toEqual([]);
    expect(parseGuideSources({ title: "x", url: "https://a.b" })).toEqual([]);
  });
});
