import { isValidElement, type ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import example from "@/lib/api/example-walkthrough.json";
import { gatedRef } from "@/lib/content/walk-refs";
import { env } from "@/lib/env";

/*
 * Server side of the walkthrough's spoilers (R13) and of the staff preview (R12), on the test
 * database: the reveal action, the unpublished-guide loader and the staff-only island.
 */

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => (session.role ? { id: "test-walk-staff", handle: "equipe", role: session.role } : null),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

const SLUG = "test-walk-preview";

describe.skipIf(!reachable)("detonado: spoilers e prévia da equipe", () => {
  let guideId = "";

  async function setStatus(status: string) {
    const { prisma } = await import("@/lib/db");
    await prisma.guide.update({ where: { id: guideId }, data: { status } });
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: SLUG } });
    const game = await prisma.game.create({
      data: {
        slug: SLUG,
        name: "Walk Preview Test",
        achievementCount: 2,
        achievements: {
          create: [
            { platform: "steam", apiName: "ACH_HEALER_LEGACY", name: "Healer's Legacy", namePt: "Legado da Curandeira" },
            { platform: "steam", apiName: "ACH_SCARLET_SPECTRAL_BLADE", name: "Scarlet Spectral Blade", namePt: "Lâmina Espectral Escarlate", hidden: true },
          ],
        },
      },
    });
    const guide = await prisma.guide.create({
      data: {
        gameId: game.id,
        status: "review",
        version: "1",
        difficulty: 5,
        hoursMin: 30,
        hoursMax: 40,
        playthroughs: "1",
        missables: 2,
        online: 0,
        overview: [],
        warnings: [],
        format: 2,
        walkthrough: example,
      },
    });
    guideId = guide.id;
  });
  beforeEach(() => {
    session.role = null;
  });
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: SLUG } });
    await prisma.$disconnect();
  });

  it("revealWalkSpoilers: guia em revisão só para a equipe; publicado para todos", async () => {
    const { revealWalkSpoilers } = await import("./reveal-spoilers");
    await setStatus("review");
    expect(await revealWalkSpoilers(guideId)).toBeNull();
    session.role = "user";
    expect(await revealWalkSpoilers(guideId)).toBeNull();
    session.role = "editor";
    const staff = await revealWalkSpoilers(guideId);
    expect(staff?.notes["1"]).toContain("todas as missões com ícone roxo");

    await setStatus("published");
    session.role = null;
    const open = await revealWalkSpoilers(guideId);
    const boss = open?.items[gatedRef("boss-hua-noiva-mortal")];
    expect(boss?.name).toBe("Chefe opcional · Hua, a Noiva Mortal");
    expect(boss?.achievement?.name).toBe("Lâmina Espectral Escarlate");
    // Only gated items travel: an ordinary one is already on the page.
    expect(Object.keys(open!.items)).toEqual([gatedRef("boss-hua-noiva-mortal")]);
  });

  it("getGuidePreview lê o guia em revisão; o público não", async () => {
    const { getGuidePreview, getGuidePublic, hasGuidePreview } = await import("@/lib/queries/games");
    await setStatus("review");
    expect(await hasGuidePreview(SLUG)).toBe(true);
    expect(await getGuidePublic(SLUG)).toBeNull();
    const preview = await getGuidePreview(SLUG);
    expect(preview?.format).toBe(2);
    expect(preview?.walkthrough?.chapters).toHaveLength(1);

    await setStatus("published");
    expect(await hasGuidePreview(SLUG)).toBe(false);
    expect(await getGuidePreview(SLUG)).toBeNull();
  });

  it("StaffGuidePreview: a equipe vê o detonado; o visitante, a página sem guia", async () => {
    const { StaffGuidePreview } = await import("@/components/guide/UserIslands");
    const { WalkthroughPage } = await import("./WalkthroughPage");
    await setStatus("review");
    const fallback = "só conquistas";

    expect(await StaffGuidePreview({ slug: SLUG, fallback })).toMatchObject({ props: { children: fallback } });
    await expect(StaffGuidePreview({ slug: SLUG, fallback: null })).rejects.toThrow(`redirect:/jogos/${SLUG}`);

    session.role = "admin";
    const page = await StaffGuidePreview({ slug: SLUG, fallback });
    expect(isValidElement(page) && (page as ReactElement).type).toBe(WalkthroughPage);
    expect((page as ReactElement<{ preview: boolean }>).props.preview).toBe(true);
  });
});
