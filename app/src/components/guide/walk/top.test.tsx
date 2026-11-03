import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyGuideUserState, type WalkAchievementView } from "@/lib/queries/games";
import { CompatSeal } from "./CompatSeal";
import { ach, pbzGuide, shipped, walkthrough } from "./walk.test-util";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/components/guide/reveal-achievement", () => ({
  revealAchievement: vi.fn(async () => ({ name: "Nome Revelado", description: null })),
}));
vi.mock("./reveal-spoilers", () => ({
  revealWalkSpoilers: vi.fn(async () => ({
    notes: { "1": "Antes de entrar na **região 9**, conclua **todas as missões com ícone roxo** no Diário." },
    callouts: {},
    items: {},
    spans: {},
  })),
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

describe("WalkthroughPage (topo)", () => {
  it("capa mostra TRALKED, Edição #001, 3 chamadas e selo TRALKED EM", () => {
    render(<WalkthroughPage guide={pbzGuide()} />);
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
    const { container } = render(<WalkthroughPage guide={pbzGuide()} />);
    expect(container.textContent).not.toMatch(/platina/i);
    expect(container.textContent).toMatch(/O caminho até o Tralked/);
  });

  it('ficha tem 8 campos e "Tempo até o Tralked"', () => {
    render(<WalkthroughPage guide={pbzGuide()} />);
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
    const { container } = render(<WalkthroughPage guide={pbzGuide()} />);
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
    render(<WalkthroughPage guide={{ ...guide, walk: { ...guide.walk!, hardest: secret } }} />);
    const field = screen.getByText("Mais difícil").closest("div")!;
    fireEvent.click(within(field).getByRole("button", { name: /mostrar/i }));
    expect(await within(field).findByText("Nome Revelado")).toBeInTheDocument();
  });

  it("selo APENAS STEAM", () => {
    render(<WalkthroughPage guide={pbzGuide()} />);
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

  it("leia antes: aviso com spoiler fica fechado até o leitor tocar", async () => {
    const { container } = render(<WalkthroughPage guide={pbzGuide()} />);
    const read = screen.getByRole("region", { name: "Leia isto para não perder nada" });
    expect(read).toHaveTextContent("Saves manuais");
    expect(container.textContent).not.toContain("todas as missões com ícone roxo");
    const gated = read.querySelector('[data-spoiler="hidden"]')!.parentElement!;
    fireEvent.click(within(gated).getByRole("button", { name: /mostrar/i }));
    // The text was never in the page: it is fetched once the reader asks.
    expect(await within(read).findByText(/todas as missões com ícone roxo/)).toBeInTheDocument();
  });

  it("roadmap lista as etapas com o número de conquistas", () => {
    render(<WalkthroughPage guide={pbzGuide()} />);
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

describe("conquista oculta da Steam", () => {
  it("nem o nome nem o apiName chegam ao navegador com spoilers desligados", () => {
    const secret: WalkAchievementView = { ...ach("ACH_SCARLET_SPECTRAL_BLADE", null, 67.1, true), id: "cm-hidden-1" };
    const guide = pbzGuide();
    // The hidden achievement is both the hardest and a missable item.
    const missable = structuredClone(walkthrough);
    const boss = missable.chapters[0].steps.flatMap((st) => st.items).find((i) => i.achievement === "ACH_SCARLET_SPECTRAL_BLADE")!;
    boss.missable = true;
    const page = (
      <WalkthroughPage
        guide={{
          ...guide,
          walkthrough: missable,
          walk: { ...guide.walk!, hardest: secret, achievements: { ...guide.walk!.achievements, ACH_SCARLET_SPECTRAL_BLADE: secret } },
        }}
       
      />
    );
    const out = shipped(page).join(" ");
    expect(out).toContain("cm-hidden-1");
    expect(out).not.toContain("ACH_SCARLET_SPECTRAL_BLADE");
    expect(out).not.toContain("Lâmina Espectral Escarlate");
  });
});
