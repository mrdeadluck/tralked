import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { prisma } = await import("@/lib/db");
const { createAchievements } = await import("@/lib/trophies/test-lists");
const { getAchievementsOnly } = await import("./achievements-only");

const SLUG = "t11-sem-guia";
const EMPTY = "t11-sem-conquistas";

beforeAll(async () => {
  await prisma.game.deleteMany({ where: { slug: { in: [SLUG, EMPTY] } } });
  const game = await prisma.game.create({
    data: {
      slug: SLUG,
      name: "Jogo Sem Guia",
      achievementCount: 2,
    },
  });
  await createAchievements(game.id, [
    { platform: "steam", apiName: "S1", name: "Steam One", namePt: "Primeira", description: "Faça tudo", globalPct: 40 },
    { platform: "steam", apiName: "S2", name: "Secret", hidden: true, globalPct: 2 },
    { platform: "psn", apiName: "P1", name: "Trophy One", globalPct: 10 },
  ]);
  await prisma.game.create({ data: { slug: EMPTY, name: "Sem Conquistas", achievementCount: 0 } });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { slug: { in: [SLUG, EMPTY] } } });
  await prisma.$disconnect();
});

describe("getAchievementsOnly", () => {
  it("jogo sem guia com conquistas steam e psn devolve as duas listas", async () => {
    const r = await getAchievementsOnly(SLUG);
    expect(r?.game.slug).toBe(SLUG);
    expect(r?.lists.map((l) => l.platform)).toEqual(["steam", "psn"]);
    const steam = r!.lists[0].achievements;
    expect(steam.map((a) => a.name)).toEqual(["Primeira", "Secret"]);
    expect(steam[1].hidden).toBe(true);
    expect(r!.lists[1].achievements[0]).toMatchObject({ name: "Trophy One", hidden: false });
  });

  it("jogo sem conquistas → null", async () => {
    expect(await getAchievementsOnly(EMPTY)).toBeNull();
    expect(await getAchievementsOnly("nao-existe-t11")).toBeNull();
  });
});

describe("maskHidden", () => {
  it("tira o texto das ocultas e mantém as demais", async () => {
    const { maskHidden } = await import("./achievements-only");
    const r = await getAchievementsOnly(SLUG);
    const steam = maskHidden(r!.lists)[0].achievements;
    expect(steam[0].name).toBe("Primeira");
    expect(steam[1]).toMatchObject({ name: "", description: null, hidden: true });
  });
});
