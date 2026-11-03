import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkGameAchievements, toggleItem } from "@/app/jogos/[slug]/guia/actions";
import { BackToTop } from "@/components/guide/BackToTop";
import { gatedRef } from "@/lib/content/walk-refs";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import { WalkUserAnon, WalkUserSeed } from "./progress";
import { walkView } from "./view";
import { pbzGuide, walkthrough } from "./walk.test-util";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/app/jogos/[slug]/guia/actions", () => ({ toggleItem: vi.fn(), checkGameAchievements: vi.fn() }));
vi.mock("@/components/fx/reward-bus", () => ({ announceReward: vi.fn(), announceToast: vi.fn() }));
vi.mock("@/components/guide/reveal-achievement", () => ({ revealAchievement: vi.fn(async () => null) }));
vi.mock("./reveal-spoilers", () => ({ revealWalkSpoilers: vi.fn(async () => null) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(async () => null) }));

/*
 * Three chapters: the example's region twice (keys apart) and the robot's cleanup chapter
 * ("limpeza"). Each has 10 items in 9 steps; step 4 holds the missable achievement Legado da
 * Curandeira (the same Steam achievement in every chapter), step 7 the missable Boulderguard and
 * step 9 the spoiler boss.
 */
const TITLES = ["Weeping Creek Valley", "Crimson Forest", "Limpeza"];
const KEYS = ["cap-1", "cap-2", "limpeza"];

function guide({ gatedBoulderguard = false } = {}) {
  const base = pbzGuide();
  const three: Walkthrough = {
    ...walkthrough,
    chapters: KEYS.map((key, c) => {
      const chapter = walkthrough.chapters[0];
      const suffix = c === 0 ? "" : `-${c + 1}`;
      return {
        ...chapter,
        key,
        title: TITLES[c],
        steps: chapter.steps.map((step) => ({
          ...step,
          key: `${step.key}${suffix}`,
          items: step.items.map((item) => ({
            ...item,
            key: `${item.key}${suffix}`,
            spoiler: item.spoiler || (gatedBoulderguard && item.key === "acessorio-boulderguard"),
          })),
        })),
      };
    }),
  };
  return { ...base, walkthrough: three };
}

const refsOf = (g: ReturnType<typeof guide>) =>
  walkView(g.walkthrough, g.walk!, g.steps).chapters.map((c) => c.steps.flatMap((s) => s.items.map((i) => i.ref)));

const CH1 = refsOf(guide())[0];
const LEGADO = "id-ACH_HEALER_LEGACY";

function seed(doneRefs: string[], unlockedIds: string[] = []) {
  return <WalkUserSeed doneRefs={doneRefs} unlockedIds={unlockedIds} unlockedCount={0} pendingXp={0} />;
}

/** Chapter 1 done, and the first two items of chapter 2: the resume point is 2.3. */
const LINEAR = seed([...CH1, "sino-lady-rift-2", "missao-triple-threat-2"]);

const scroll = vi.fn();
const scrolled = () => scroll.mock.contexts.map((el) => (el as HTMLElement).id);

beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  vi.mocked(toggleItem).mockResolvedValue({ status: "ok", done: true });
  vi.mocked(checkGameAchievements).mockResolvedValue({ status: "ok", newUnlocks: [], reward: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("botão da capa", () => {
  const cover = () => screen.getByRole("region", { name: /Guia Tralked de/ });

  it("enquanto a sessão chega: um esqueleto, sem botão", () => {
    const { container } = render(<WalkthroughPage guide={guide()} />);
    expect(container.querySelector(".wk-resume-sk")).not.toBeNull();
    expect(within(cover()).queryByRole("button")).toBeNull();
  });

  it("visitante anônimo: convite para entrar que volta ao guia, sem capítulo aceso", async () => {
    const { container } = render(<WalkthroughPage guide={guide()} user={<WalkUserAnon />} />);
    const link = await within(cover()).findByRole("link", { name: "Entre para continuar de onde parou" });
    expect(link).toHaveAttribute("href", "/entrar?returnTo=%2Fjogos%2Fphantom-blade-zero%2Fguia");
    expect(container.querySelector(".wk-resume-sk")).toBeNull();
    expect(container.querySelectorAll(".wk-hn.lit, .wk-hn.here")).toHaveLength(0);
  });

  it("sem progresso: Começar o detonado, que leva ao primeiro item", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([])} />);
    fireEvent.click(await within(cover()).findByRole("button", { name: "Começar o detonado" }));
    expect(scrolled()).toEqual(["item-sino-lady-rift"]);
  });

  it("com progresso: Continuar de onde parou rola até o item e o destaca", async () => {
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    const button = await within(cover()).findByRole("button", { name: "Continuar de onde parou" });
    expect(cover()).toHaveTextContent("Crimson Forest · passo 2.3");
    fireEvent.click(button);
    expect(scrolled()).toEqual(["item-acessorio-hunters-insight-2"]);
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.getElementById("item-acessorio-hunters-insight-2")).toHaveClass("wk-hl");
  });

  it("reduced motion: o salto é instantâneo", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    fireEvent.click(await within(cover()).findByRole("button", { name: "Continuar de onde parou" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });

  it("item com spoiler: rola até ele sem mostrar o nome", async () => {
    const boss = gatedRef("boss-hua-noiva-mortal");
    render(<WalkthroughPage guide={guide()} user={seed(CH1.slice(0, 9))} />);
    fireEvent.click(await within(cover()).findByRole("button", { name: "Continuar de onde parou" }));
    expect(scrolled()).toEqual([`item-${boss}`]);
    expect(document.body.textContent).not.toContain("Noiva Mortal");
  });

  it("tudo feito: Guia concluído leva ao último capítulo", async () => {
    render(<WalkthroughPage guide={guide()} user={seed(refsOf(guide()).flat())} />);
    fireEvent.click(await within(cover()).findByRole("button", { name: "Guia concluído" }));
    expect(scrolled()).toEqual(["cap-limpeza"]);
  });
});

describe('"você está aqui"', () => {
  const marker = () => screen.findByRole("complementary", { name: "Você está aqui" });

  it("pelos itens marcados, no passo do retorno", async () => {
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    const here = await marker();
    expect(here).toHaveTextContent("Pelos itens que você marcou, você está aqui: Crimson Forest, passo 2.3.");
    expect(here.closest("article")).toHaveAttribute("aria-label", "Passo 2.3");
    expect(here).not.toHaveTextContent("ficaram para trás");
    expect(screen.getAllByRole("complementary", { name: "Você está aqui" })).toHaveLength(1);
  });

  it("pelas conquistas, com os itens que ficaram para trás e o link para o primeiro", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([], [LEGADO])} />);
    const here = await marker();
    expect(here).toHaveTextContent("De acordo com suas conquistas, você está aqui na história: Weeping Creek Valley, passo 1.4.");
    expect(here).toHaveTextContent("3 itens ficaram para trás.");
    const first = within(here).getByRole("link", { name: "Ver o primeiro" });
    expect(first).toHaveAttribute("href", "#item-sino-lady-rift");
    fireEvent.click(first);
    expect(scrolled()).toEqual(["item-sino-lady-rift"]);
  });

  it("pelos dois", async () => {
    render(<WalkthroughPage guide={guide()} user={seed(["sino-lady-rift"], [LEGADO])} />);
    expect(await marker()).toHaveTextContent(
      "Pelas suas conquistas e pelos itens que você marcou, você está aqui na história",
    );
  });

  it("sem progresso, nenhum marcador", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([])} />);
    await screen.findByRole("button", { name: "Começar o detonado" });
    expect(screen.queryByRole("complementary", { name: "Você está aqui" })).toBeNull();
  });
});

describe('"Talvez você tenha perdido"', () => {
  it("lista os perdíveis para trás, com link, e o nome com spoiler fica escondido", async () => {
    const g = guide({ gatedBoulderguard: true });
    const boulder = gatedRef("acessorio-boulderguard");
    const done = refsOf(g)[0].filter((ref) => ref !== "conquista-legado-curandeira" && ref !== boulder);
    render(<WalkthroughPage guide={g} user={seed(done)} />);
    const panel = await screen.findByRole("complementary", { name: "Talvez você tenha perdido" });
    expect(panel).toHaveTextContent("Legado da Curandeira");
    expect(panel).toHaveTextContent(/talvez/i);
    expect(panel).toHaveTextContent("nova jogada ou da seleção de capítulos");
    expect(panel).not.toHaveTextContent("Boulderguard");
    expect(within(panel).getByRole("button", { name: "Mostrar o perdível" })).toBeInTheDocument();
    expect(within(panel).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "#item-conquista-legado-curandeira",
      `#item-${boulder}`,
    ]);
    // The panel sits at the marker (the resume step, 2.1).
    expect(panel.closest("article")).toHaveAttribute("aria-label", "Passo 2.1");
  });
});

describe("capítulos acesos", () => {
  it("na jornada e na linha do tempo: passados acesos, o do retorno diz você está aqui", async () => {
    const { container } = render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    await waitFor(() => expect(journey.querySelectorAll("li")[0]).toHaveClass("lit"));
    const [one, two, three] = journey.querySelectorAll("li");
    expect(one).not.toHaveClass("here");
    expect(two).toHaveClass("here");
    expect(two).not.toHaveClass("lit");
    expect(two).toHaveTextContent("você está aqui");
    expect(within(two).getByRole("link")).toHaveAttribute("href", "#item-acessorio-hunters-insight-2");
    expect(within(one).getByRole("link")).toHaveAttribute("href", "#cap-cap-1");
    expect(three).not.toHaveClass("lit");
    expect(three).not.toHaveClass("here");

    const before3 = container.querySelector("#cap-limpeza .wk-jgap")!;
    const row = before3.querySelectorAll("li");
    expect(row[0]).toHaveClass("lit");
    expect(row[0]).toHaveClass("p");
    expect(row[1]).toHaveClass("here");
    expect(row[2]).toHaveClass("c");

    fireEvent.click(within(two).getByRole("link"));
    expect(scrolled()).toEqual(["item-acessorio-hunters-insight-2"]);
  });

  it("conquista desbloqueada conta como feito: linha, contagens e capítulo", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([], [LEGADO])} />);
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    // The achievement is on an item of each chapter.
    await waitFor(() => expect(journey.querySelectorAll("li")[0]).toHaveTextContent(/1\/10/));
    expect(journey.querySelectorAll("li")[2]).toHaveTextContent(/1\/10/);
    const row = document.getElementById("item-conquista-legado-curandeira")!;
    expect(row).toHaveClass("done");
    expect(within(row).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("complementary", { name: "Resumo de Weeping Creek Valley" })).getByText("1 / 10")).toBeInTheDocument();
    expect(document.querySelector(".wk-pct")).toHaveTextContent("3 / 30");
  });
});

describe("sincronização", () => {
  it("ao carregar não rola; depois de conferir com novas conquistas, rola até o retorno e diz por quê", async () => {
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    await screen.findByRole("button", { name: "Continuar de onde parou" });
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();

    vi.mocked(checkGameAchievements).mockResolvedValue({
      status: "ok",
      newUnlocks: [{ id: LEGADO, apiName: "ACH_HEALER_LEGACY", name: "Legado da Curandeira", iconUrl: null }],
      reward: null,
    });
    const legado2 = document.getElementById("item-conquista-legado-curandeira-2")!;
    fireEvent.click(within(legado2).getByRole("checkbox"));
    await waitFor(() => expect(scrolled()).toEqual(["item-arma-sanguine-twin-2"]));
    const here = screen.getByRole("complementary", { name: "Você está aqui" });
    expect(here.closest("article")).toHaveAttribute("aria-label", "Passo 2.4");
    expect(within(here).getByRole("status")).toHaveTextContent("Pelas suas conquistas e pelos itens que você marcou");
  });

  it("a nova conferência automática (depois de 30 s) não mexe na página", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      render(<WalkthroughPage guide={guide()} user={LINEAR} />);
      await screen.findByRole("button", { name: "Continuar de onde parou" });
      const legado2 = document.getElementById("item-conquista-legado-curandeira-2")!;
      fireEvent.click(within(legado2).getByRole("checkbox"));
      await waitFor(() => expect(checkGameAchievements).toHaveBeenCalledTimes(1));
      vi.mocked(checkGameAchievements).mockResolvedValue({
        status: "ok",
        newUnlocks: [{ id: LEGADO, apiName: "ACH_HEALER_LEGACY", name: "Legado da Curandeira", iconUrl: null }],
        reward: null,
      });
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(checkGameAchievements).toHaveBeenCalledTimes(2);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("voltar ao topo", () => {
  async function scrollTo(y: number) {
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
    fireEvent.scroll(window);
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }

  it("aparece depois de 1,5 tela e volta ao topo (instantâneo com reduced motion)", async () => {
    vi.stubGlobal("innerHeight", 1000);
    const top = vi.fn();
    vi.stubGlobal("scrollTo", top);
    render(<BackToTop />);
    await scrollTo(0);
    expect(screen.queryByRole("button", { name: "Voltar ao topo" })).toBeNull();
    await scrollTo(1400);
    expect(screen.queryByRole("button", { name: "Voltar ao topo" })).toBeNull();
    await scrollTo(1600);
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao topo" }));
    expect(top).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao topo" }));
    expect(top).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    await scrollTo(200);
    expect(screen.queryByRole("button", { name: "Voltar ao topo" })).toBeNull();
  });

  it("também está na página do detonado", async () => {
    vi.stubGlobal("innerHeight", 1000);
    render(<WalkthroughPage guide={guide()} />);
    await scrollTo(2000);
    expect(screen.getByRole("button", { name: "Voltar ao topo" })).toBeInTheDocument();
  });
});

describe("fontes na linha do item", () => {
  it('o público vê as fontes com crédito, sem "em revisão" nem a contagem', () => {
    const { container } = render(<WalkthroughPage guide={guide()} user={<WalkUserAnon />} />);
    const amber = document.getElementById("item-fragmento-ambar-1")!;
    expect(amber.querySelector(".src")).toHaveTextContent(/^Fontes: /);
    expect(within(amber).getAllByRole("link").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("em revisão");
    expect(container.textContent).not.toMatch(/[●✓] \d+ fontes?/);
  });

  it('a prévia da equipe ainda mostra "em revisão"', () => {
    render(<WalkthroughPage guide={guide()} preview />);
    expect(document.getElementById("item-fragmento-ambar-1")).toHaveTextContent("● 2 fontes · em revisão");
  });
});
