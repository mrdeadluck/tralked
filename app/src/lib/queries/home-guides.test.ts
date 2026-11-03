import { afterAll, beforeAll, describe, expect, it } from "vitest";
import example from "@/lib/api/example-walkthrough.json";

const { prisma } = await import("@/lib/db");
const { getHomeGuides } = await import("./home-guides");

const PREFIX = "t27-guia-";
const HOUR = 3_600_000;
const now = Date.now();
const ago = (hours: number) => new Date(now - hours * HOUR);

const twoChapters = {
  ...example,
  chapters: [example.chapters[0], { ...example.chapters[0], key: "cap-2", steps: [{ ...example.chapters[0].steps[0], key: "passo-2", items: [] }] }],
};
const psnWalk = {
  ...example,
  compat: "psn_xbox",
  scope: "psn",
  psnList: { total: 3, names: ["Platina", "Ouro", "Prata"] },
  steamOnly: [],
};

type Fixture = {
  slug: string;
  status?: string;
  format: number;
  publishedAt: Date | null;
  walkthrough?: unknown;
  compat?: string;
  report?: unknown;
  steamAchievements?: number;
};

const FIXTURES: Fixture[] = [
  // Walkthroughs, newest first: with a report (its coverage counts), without one (the game's list counts), PSN list.
  { slug: "detonado-novo", format: 2, publishedAt: ago(2), walkthrough: twoChapters, compat: "psn", report: { coverage: { steam: 66, covered: 66, steamOnly: 0 } }, steamAchievements: 3 },
  { slug: "detonado-psn", format: 2, publishedAt: ago(30), walkthrough: psnWalk, compat: "psn_xbox", steamAchievements: 4 },
  { slug: "detonado-velho", format: 2, publishedAt: ago(24 * 20), walkthrough: example, compat: "steam_only", steamAchievements: 2 },
  // Stored walkthrough the guide page cannot show ("guia indisponível"): never advertised.
  { slug: "detonado-invalido", format: 2, publishedAt: ago(1), walkthrough: { chapters: [] }, compat: "steam_only" },
  // Classic guides come after every walkthrough, even when newer.
  { slug: "classico-novo", format: 1, publishedAt: ago(0.5), steamAchievements: 1 },
  { slug: "classico-velho", format: 1, publishedAt: ago(48), steamAchievements: 0 },
  // Not published: never listed.
  { slug: "rascunho", status: "draft", format: 1, publishedAt: null, steamAchievements: 5 },
  { slug: "revisao", status: "review", format: 2, publishedAt: null, walkthrough: example, compat: "steam_only" },
];

beforeAll(async () => {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  for (const [i, f] of FIXTURES.entries()) {
    await prisma.game.create({
      data: {
        slug: PREFIX + f.slug,
        name: `Jogo ${f.slug}`,
        coverUrl: `https://cdn.example.com/${f.slug}.jpg`,
        steamAppId: 927_000 + i,
        achievementCount: f.steamAchievements ?? 0,
        achievements: {
          create: Array.from({ length: f.steamAchievements ?? 0 }, (_, n) => ({ platform: "steam", apiName: `ACH_${n}`, name: `Conquista ${n}` })),
        },
        guide: {
          create: {
            status: f.status ?? "published",
            publishedAt: f.publishedAt,
            version: "v1.0",
            format: f.format,
            walkthrough: f.walkthrough as object | undefined,
            compat: f.compat,
            report: f.report as object | undefined,
            difficulty: 5,
            hoursMin: 10,
            hoursMax: 20,
            playthroughs: "1",
            missables: 0,
            online: 0,
          },
        },
      },
    });
  }
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

const ours = async () => (await getHomeGuides(100)).filter((g) => g.slug.startsWith(PREFIX));

describe("getHomeGuides", () => {
  it("lists published guides only: walkthroughs first, then classic guides, newest first in each", async () => {
    expect((await ours()).map((g) => g.slug.slice(PREFIX.length))).toEqual([
      "detonado-novo",
      "detonado-psn",
      "detonado-velho",
      "classico-novo",
      "classico-velho",
    ]);
  });

  it("describes each guide from its stored data: chapters, coverage and platform seals", async () => {
    const bySlug = new Map((await ours()).map((g) => [g.slug.slice(PREFIX.length), g]));
    expect(bySlug.get("detonado-novo")).toMatchObject({
      name: "Jogo detonado-novo",
      href: `/jogos/${PREFIX}detonado-novo/guia`,
      coverUrl: "https://cdn.example.com/detonado-novo.jpg",
      kind: "walkthrough",
      // The report's coverage (66), not the 3 achievements the catalog holds.
      line: "Detonado completo · 2 capítulos · 66 conquistas Steam",
      seals: ["steam", "psn"],
      publishedAt: FIXTURES[0].publishedAt,
    });
    expect(bySlug.get("detonado-psn")).toMatchObject({
      line: "Detonado completo · 1 capítulo · 3 troféus PSN",
      seals: ["psn"],
    });
    expect(bySlug.get("detonado-velho")).toMatchObject({
      line: "Detonado completo · 1 capítulo · 2 conquistas Steam",
      seals: ["steam"],
    });
    expect(bySlug.get("classico-novo")).toMatchObject({ kind: "classic", line: "Guia 100% · 1 conquista Steam", seals: ["steam"] });
    expect(bySlug.get("classico-velho")).toMatchObject({ line: "Guia 100%", seals: [] });
  });

  it("shows up to 4 guides by default", async () => {
    const guides = await getHomeGuides();
    expect(guides).toHaveLength(4);
    const kinds = guides.map((g) => g.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === "walkthrough" ? -1 : 1)));
  });
});
