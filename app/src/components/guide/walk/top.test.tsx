import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import example from "@/lib/api/example-walkthrough.json";
import { walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { applyGuideUserState, type GuideDetail, type WalkAchievementView } from "@/lib/queries/games";
import { CompatSeal } from "./CompatSeal";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/components/guide/reveal-achievement", () => ({
  revealAchievement: vi.fn(async () => ({ name: "Nome Revelado", description: null })),
}));

// The page reads the guide through the cached helpers; tests read the database directly.
vi.mock("@/lib/queries/games-cached", async () => {
  const games = await import("@/lib/queries/games");
  return {
    getGuideCached: vi.fn(games.getGuidePublic),
    getGameCached: games.getGame,
    getAchievementsOnlyCached: vi.fn(async () => null),
  };
});
vi.mock("@/lib/community/cached", () => ({ guideIdCached: vi.fn(async () => null) }));

afterEach(cleanup);

const walkthrough = walkthroughSchema.parse(example);

function ach(apiName: string, name: string | null, globalPct: number, hidden = false): WalkAchievementView {
  return { id: `id-${apiName}`, apiName, name, description: null, iconUrl: null, globalPct, hidden, xp: 50, done: false };
}

const hardest = ach("ACH_TRUE_ENDING", "Sangue e Coração", 4.7);

/** The Phantom Blade Zero guide as getGuidePublic returns it (format 2, edition 1). */
function pbzGuide(over: Partial<GuideDetail> = {}): GuideDetail {
  const now = new Date("2026-11-03T12:00:00Z");
  return {
    game: {
      id: "game-pbz",
      slug: "phantom-blade-zero",
      name: "Phantom Blade Zero",
      summary: null,
      coverUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/library_600x900.jpg",
      platforms: ["PC", "PLAYSTATION"],
      skills: [],
      achievementCount: 66,
      heroUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/library_hero.jpg",
      timeToBeatCompleteMin: null,
      progress: null,
      generatedAt: now,
      guide: {
        version: null,
        updatedAt: now,
        dateKind: "published",
        authorHandle: null,
        reviewers: [],
        stepCount: 1,
        human: false,
      },
    },
    format: 2,
    walkthrough,
    edition: 1,
    compat: "steam_only",
    report: null,
    walk: {
      guideId: "guide-pbz",
      steamAppId: 4115450,
      logoUrl: null,
      hours: { min: 30, max: 40 },
      hiddenCount: 36,
      achievements: {
        ACH_TRUE_ENDING: hardest,
        ACH_HEALER_LEGACY: ach("ACH_HEALER_LEGACY", "Legado da Curandeira", 13.9),
        ACH_SCARLET_SPECTRAL_BLADE: ach("ACH_SCARLET_SPECTRAL_BLADE", null, 67.1, true),
      },
      hardest,
      compatCounts: { steam: 66, ps5: 36 },
    },
    itemsDone: new Set(),
    facts: { difficulty: 5, timeTo100: null, playthroughs: "1", missables: 7, online: 0 },
    overview: ["Phantom Blade Zero é um soulslike de ação com nove regiões ligadas."],
    warnings: [],
    collectibles: [],
    steps: [
      {
        id: "s1",
        key: "ate-mirage-estate",
        order: 0,
        title: "Até a Mirage Estate",
        hours: "4 a 6 h",
        body: "Weeping Creek Valley e a Crimson Forest, com os coletáveis de cada região.",
        blocks: null,
        cards: {},
        achievements: [],
        done: false,
      },
    ],
    achievements: [],
    tips: [],
    revisions: [],
    sources: [{ title: "PowerPyx", url: "https://www.powerpyx.com/" }],
    totals: { xp: 150, pendingCount: 3, pendingXp: 150 },
    skillLevels: [],
    ...over,
  };
}

describe("WalkthroughPage (topo)", () => {
  it("capa mostra TRALKED, Edição #001, 3 chamadas e selo TRALKED EM", () => {
    render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    const cover = screen.getByRole("figure", { name: /capa/i });
    expect(cover).toHaveTextContent("TRALKED");
    expect(cover).toHaveTextContent("Edição #001");
    const calls = within(within(cover).getByRole("list")).getAllByRole("listitem");
    expect(calls).toHaveLength(3);
    expect(calls[0]).toHaveTextContent("5/10");
    expect(calls[0]).toHaveTextContent("Dificuldade");
    expect(cover).toHaveTextContent(/TRALKED EM\s*30–40 h/);
    expect(cover).toHaveTextContent(/1 zerada/i);
    // The logo is SVG text stretched to the full width (textLength), so it is never cut.
    const logo = cover.querySelector("svg text");
    expect(logo).toHaveTextContent("TRALKED");
    expect(logo).toHaveAttribute("textLength");
  });

  it('nenhum texto da página contém "platina"', () => {
    const { container } = render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    expect(container.textContent).not.toMatch(/platina/i);
    expect(container.textContent).toMatch(/O caminho até o Tralked/);
  });

  it('ficha tem 8 campos e "Tempo até o Tralked"', () => {
    render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    const ficha = screen.getByRole("region", { name: "Ficha do guia" });
    expect(within(ficha).getAllByRole("term")).toHaveLength(8);
    expect(within(ficha).getByText("Tempo até o Tralked")).toBeInTheDocument();
    expect(ficha).toHaveTextContent("30–40");
    expect(ficha).toHaveTextContent("36 ocultas");
    expect(ficha).toHaveTextContent("Tralked 100% offline");
    // The guide's XP sits under the 8 fields.
    expect(ficha).toHaveTextContent(/XP do guia/);
  });

  it("mais difícil borrado sem spoilers", async () => {
    const { container } = render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    expect(container.textContent).not.toContain("Sangue e Coração");
    const field = screen.getByText("Mais difícil").closest("div")!;
    expect(field.querySelector('[data-spoiler="hidden"]')).not.toBeNull();
    expect(field).toHaveTextContent("4,7% dos jogadores na Steam");
    fireEvent.click(within(field).getByRole("button", { name: /mostrar/i }));
    expect(await within(field).findByText("Sangue e Coração")).toBeInTheDocument();
  });

  it("mais difícil oculto na Steam só chega depois de revelar", async () => {
    const secret = ach("ACH_TRUE_ENDING", null, 4.7, true);
    const guide = pbzGuide();
    render(<WalkthroughPage guide={{ ...guide, walk: { ...guide.walk!, hardest: secret } }} viewer={null} />);
    const field = screen.getByText("Mais difícil").closest("div")!;
    fireEvent.click(within(field).getByRole("button", { name: /mostrar/i }));
    expect(await within(field).findByText("Nome Revelado")).toBeInTheDocument();
  });

  it("selo APENAS STEAM", () => {
    render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    expect(screen.getByText("APENAS STEAM")).toBeInTheDocument();
    expect(screen.getByText(/Steam tem 66 conquistas; o PS5 tem 36/)).toBeInTheDocument();
  });

  it("selo das outras compatibilidades", () => {
    const { rerender } = render(<CompatSeal compat="psn_xbox" counts={null} />);
    expect(screen.getByText("COMPATÍVEL COM PSN E XBOX")).toBeInTheDocument();
    rerender(<CompatSeal compat="psn" counts={null} />);
    expect(screen.getByText("COMPATÍVEL COM PSN")).toBeInTheDocument();
    rerender(<CompatSeal compat="xbox" counts={null} />);
    expect(screen.getByText("COMPATÍVEL COM XBOX")).toBeInTheDocument();
    rerender(<CompatSeal compat="steam_only" counts={null} />);
    expect(screen.getByText("APENAS STEAM")).toBeInTheDocument();
    expect(screen.queryByText(/o PS5 tem/)).toBeNull();
  });

  it("leia antes: aviso com spoiler fica fechado até o leitor tocar", () => {
    const { container } = render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    const read = screen.getByRole("region", { name: "Leia isto para não perder nada" });
    expect(read).toHaveTextContent("Saves manuais");
    expect(container.textContent).not.toContain("todas as missões com ícone roxo");
    const gated = read.querySelector('[data-spoiler="hidden"]')!.parentElement!;
    fireEvent.click(within(gated).getByRole("button", { name: /mostrar/i }));
    expect(read).toHaveTextContent("todas as missões com ícone roxo");
  });

  it("roadmap lista as etapas com o número de conquistas", () => {
    render(<WalkthroughPage guide={pbzGuide()} viewer={null} />);
    const road = screen.getByRole("region", { name: "O caminho até o Tralked" });
    expect(road).toHaveTextContent("Até a Mirage Estate");
    // Chapters of the phase "ate-mirage-estate" hold 2 achievement items in the fixture.
    expect(road).toHaveTextContent("2 conquistas");
  });
});

describe("applyGuideUserState (formato 2)", () => {
  it("marca os itens feitos e as conquistas da Steam do visitante", () => {
    const view = applyGuideUserState(pbzGuide(), {
      progress: { unlockedCount: 15, playtimeMin: 600 },
      unlockedAchievementIds: ["id-ACH_HEALER_LEGACY"],
      doneStepIds: [],
      doneItemKeys: ["sino-lady-rift"],
      votedTipIds: [],
      ownTipIds: [],
      skillLevels: {},
    });
    expect(view.itemsDone).toEqual(new Set(["sino-lady-rift"]));
    expect(view.walk!.achievements.ACH_HEALER_LEGACY.done).toBe(true);
    expect(view.totals.pendingCount).toBe(2);
    expect(view.totals.pendingXp).toBe(100);
  });
});

/** Every element type in a server-rendered tree (without rendering async components). */
function typesIn(node: ReactNode, out = new Set<unknown>()): Set<unknown> {
  if (Array.isArray(node)) node.forEach((child) => typesIn(child, out));
  else if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode; fallback?: ReactNode }>;
    out.add(el.type);
    typesIn(el.props.children, out);
    typesIn(el.props.fallback, out);
  }
  return out;
}

describe("página /jogos/[slug]/guia", () => {
  it("formato 1 continua renderizando o guia antigo", async () => {
    const { default: GuidePage } = await import("@/app/jogos/[slug]/guia/page");
    const { Overview } = await import("@/components/guide/Overview");
    const { FactsStrip } = await import("@/components/games/FactsStrip");
    const tree = await GuidePage({ params: Promise.resolve({ slug: "hollow-knight" }) } as never);
    const types = typesIn(tree);
    expect(types).toContain(Overview);
    expect(types).toContain(FactsStrip);
    expect(types).not.toContain(WalkthroughPage);
  });

  it("formato 2 renderiza o detonado", async () => {
    const cached = await import("@/lib/queries/games-cached");
    vi.mocked(cached.getGuideCached).mockResolvedValueOnce(pbzGuide());
    const { default: GuidePage } = await import("@/app/jogos/[slug]/guia/page");
    const tree = await GuidePage({ params: Promise.resolve({ slug: "phantom-blade-zero" }) } as never);
    expect(typesIn(tree)).toContain(WalkthroughPage);
  });
});
