import { afterAll, beforeAll, describe, expect, it } from "vitest";
import example from "@/lib/api/example-walkthrough.json";

const { prisma } = await import("@/lib/db");
const { getGuidePublic, loadGuideReport, loadGuideUserState } = await import("./games");

const SLUG = "t12-detonado";
const HANDLE = "t12-leitor";
const REPORT = {
  sourcesRead: [{ name: "PowerPyx", url: "https://www.powerpyx.com/", ok: true }],
  divergences: ["O PowerPyx diz 23 sinos e lista 22."],
  singleSource: [],
  coverage: { steam: 66, covered: 66, steamOnly: 30 },
  spendUsd: 0.4,
};

let guideId = "";
let userId = "";

beforeAll(async () => {
  await prisma.game.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { handle: HANDLE } });
  const game = await prisma.game.create({
    data: {
      slug: SLUG,
      name: "Detonado de Teste",
      steamAppId: 912_345_001,
      logoUrl: "https://cdn.example.com/logo.png",
      achievementCount: 3,
      achievements: {
        create: [
          { platform: "steam", apiName: "ACH_TRUE_ENDING", name: "Blood and Heart", namePt: "Sangue e Coração", globalPct: 4.7 },
          { platform: "steam", apiName: "ACH_HEALER_LEGACY", name: "Healer's Legacy", namePt: "Legado da Curandeira", globalPct: 13.9 },
          { platform: "steam", apiName: "ACH_SCARLET_SPECTRAL_BLADE", name: "Scarlet Blade", namePt: "Lâmina Escarlate", hidden: true, globalPct: 67.1 },
        ],
      },
    },
  });
  const guide = await prisma.guide.create({
    data: {
      gameId: game.id,
      status: "published",
      publishedAt: new Date(),
      version: "v1.0",
      format: 2,
      walkthrough: example,
      edition: 912_001,
      compat: "steam_only",
      report: REPORT,
      difficulty: 5,
      hoursMin: 30,
      hoursMax: 40,
      playthroughs: "1",
      missables: 7,
      online: 0,
      overview: ["Um soulslike."],
      warnings: [],
      source: "bot",
      steps: { create: [{ order: 0, key: "ate-mirage-estate", title: "Até a Mirage Estate", hours: "4 a 6 h", body: "Regiões 1 a 7." }] },
    },
  });
  guideId = guide.id;
  const user = await prisma.user.create({ data: { handle: HANDLE, displayName: "Leitor T12" } });
  userId = user.id;
  await prisma.guideItemProgress.create({ data: { userId, guideId, itemKey: "sino-lady-rift" } });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { handle: HANDLE } });
  await prisma.$disconnect();
});

describe("getGuidePublic (formato 2)", () => {
  it("traz o detonado, a edição e o selo, sem o relatório do robô", async () => {
    const guide = await getGuidePublic(SLUG);
    expect(guide).not.toBeNull();
    expect(guide!.format).toBe(2);
    expect(guide!.walkthrough?.cover.calls).toHaveLength(3);
    expect(guide!.edition).toBe(912_001);
    expect(guide!.compat).toBe("steam_only");
    expect(guide!.report).toBeNull();
    expect(JSON.stringify(guide!.walk)).not.toContain("23 sinos");
    expect(guide!.walk).toMatchObject({
      guideId,
      steamAppId: 912_345_001,
      logoUrl: "https://cdn.example.com/logo.png",
      hours: { min: 30, max: 40 },
      hiddenCount: 1,
      compatCounts: { steam: 66, ps5: 36 },
    });
    expect(guide!.walk!.hardest).toMatchObject({ name: "Sangue e Coração", globalPct: 4.7, hidden: false });
    expect(guide!.steps[0].key).toBe("ate-mirage-estate");
    expect(guide!.itemsDone.size).toBe(0);
  });

  it("conquista oculta chega sem nome, descrição nem ícone", async () => {
    const guide = await getGuidePublic(SLUG);
    expect(guide!.walk!.achievements.ACH_SCARLET_SPECTRAL_BLADE).toMatchObject({
      name: null,
      description: null,
      iconUrl: null,
      hidden: true,
    });
    expect(JSON.stringify(guide!.walk)).not.toContain("Lâmina Escarlate");
  });

  it("o XP do guia soma a lista inteira da Steam", async () => {
    const guide = await getGuidePublic(SLUG);
    const xp = Object.values(guide!.walk!.achievements).reduce((sum, a) => sum + a.xp, 0);
    expect(guide!.totals).toMatchObject({ xp, pendingCount: 3, pendingXp: xp });
  });

  it("o estado do leitor traz os itens marcados", async () => {
    const guide = await getGuidePublic(SLUG);
    const state = await loadGuideUserState(guide!, userId);
    expect(state.doneItemKeys).toEqual(["sino-lady-rift"]);
  });

  it("loadGuideReport devolve o relatório (só para staff)", async () => {
    expect((await loadGuideReport(guideId))?.coverage).toEqual({ steam: 66, covered: 66, steamOnly: 30 });
  });
});
