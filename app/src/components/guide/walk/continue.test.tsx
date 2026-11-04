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
/** jsdom's own window.scrollY, put back after the tests that scroll. */
const SCROLL_Y = Object.getOwnPropertyDescriptor(window, "scrollY");

beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  vi.mocked(toggleItem).mockResolvedValue({ status: "ok", done: true });
  vi.mocked(checkGameAchievements).mockResolvedValue({ status: "ok", newUnlocks: [], reward: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  if (SCROLL_Y) Object.defineProperty(window, "scrollY", SCROLL_Y);
  else delete (window as { scrollY?: number }).scrollY;
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
  const UNLOCK = {
    status: "ok" as const,
    newUnlocks: [{ id: LEGADO, apiName: "ACH_HEALER_LEGACY", name: "Legado da Curandeira", iconUrl: null }],
    reward: null,
  };
  const live = () => document.querySelector<HTMLElement>(".sr-only[aria-live]")!;

  it("marcar uma conquista que ficou para trás, com a Steam confirmando, não mexe na página", async () => {
    const behind = CH1.filter((ref) => ref !== "conquista-legado-curandeira");
    render(<WalkthroughPage guide={guide()} user={seed([...behind, "sino-lady-rift-2", "missao-triple-threat-2"])} />);
    await screen.findByRole("button", { name: "Continuar de onde parou" });
    vi.mocked(checkGameAchievements).mockResolvedValue(UNLOCK);
    const legado = document.getElementById("item-conquista-legado-curandeira")!;
    fireEvent.click(within(legado).getByRole("checkbox"));
    expect(await within(legado).findByText("✓ Confirmada pela Steam")).toBeInTheDocument();
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();
    expect(live()).toBeEmptyDOMElement();
  });

  it("ao carregar não rola; Sincronizar conquistas pergunta à Steam, diz onde você está e leva até lá", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      render(<WalkthroughPage guide={guide()} user={LINEAR} />);
      const sync = await screen.findByRole("button", { name: "Sincronizar conquistas" });
      await act(async () => {});
      expect(scroll).not.toHaveBeenCalled();

      vi.mocked(checkGameAchievements).mockResolvedValue(UNLOCK);
      fireEvent.click(sync);
      await waitFor(() => expect(scrolled()).toEqual(["item-acessorio-hunters-insight-2"]));
      expect(checkGameAchievements).toHaveBeenCalledWith("game-pbz");
      const text =
        "Pelas suas conquistas e pelos itens que você marcou, você está aqui na história: Crimson Forest, passo 2.3.";
      expect(live()).toHaveTextContent(text);
      expect(live()).toHaveAttribute("role", "status");
      const here = screen.getByRole("complementary", { name: "Você está aqui" });
      expect(here).toHaveTextContent(text);
      expect(here).toHaveClass("now");
      // The new unlock counts as done (the achievement's item of chapter 2).
      expect(document.getElementById("item-conquista-legado-curandeira-2")).toHaveClass("done");

      // The glow and the announcement go after a few seconds; the marker stays.
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(here).not.toHaveClass("now");
      expect(live()).toBeEmptyDOMElement();
      expect(screen.getByRole("complementary", { name: "Você está aqui" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem conquista nova a sincronização também diz onde você está e leva até lá", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([])} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar conquistas" }));
    await waitFor(() => expect(scrolled()).toEqual(["item-sino-lady-rift"]));
    expect(live()).toHaveTextContent(
      "Sua Steam ainda não tem conquistas deste guia: o detonado começa aqui, Weeping Creek Valley, passo 1.1.",
    );
    expect(screen.getByRole("complementary", { name: "Você está aqui" })).toHaveTextContent("o detonado começa aqui");
  });

  it("reduced motion: a sincronização leva até lá sem animação", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar conquistas" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "center" }));
  });

  it("Steam não ligada: convite para ligar, nada rola", async () => {
    vi.mocked(checkGameAchievements).mockResolvedValue({ status: "unlinked", newUnlocks: [], reward: null });
    render(<WalkthroughPage guide={guide()} user={LINEAR} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar conquistas" }));
    expect(await screen.findByRole("link", { name: "Ligue sua Steam para sincronizar" })).toHaveAttribute(
      "href",
      "/conta/conexoes",
    );
    expect(scroll).not.toHaveBeenCalled();
  });

  it("jogo fora da biblioteca Steam (unlockedCount null): o convite no lugar do botão", async () => {
    render(
      <WalkthroughPage
        guide={guide()}
        user={<WalkUserSeed doneRefs={CH1} unlockedIds={[]} unlockedCount={null} pendingXp={0} />}
      />,
    );
    expect(await screen.findByRole("link", { name: "Ligue sua Steam para sincronizar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sincronizar conquistas" })).toBeNull();
  });

  it("anônimo não vê o botão de sincronizar", async () => {
    render(<WalkthroughPage guide={guide()} user={<WalkUserAnon />} />);
    await screen.findByRole("link", { name: "Entre para continuar de onde parou" });
    expect(screen.queryByRole("button", { name: "Sincronizar conquistas" })).toBeNull();
  });
});

describe("linha do item confirmada pela Steam", () => {
  it("desbloqueada sem marca: a caixa diz que a Steam confirmou e não marca nada", async () => {
    render(<WalkthroughPage guide={guide()} user={seed([], [LEGADO])} />);
    const row = document.getElementById("item-conquista-legado-curandeira")!;
    const box = await within(row).findByRole("checkbox", { name: /confirmada pela Steam/ });
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveAttribute("aria-checked", "true");
    fireEvent.click(box);
    expect(toggleItem).not.toHaveBeenCalled();
  });
});

describe("aviso de perdível que dá para voltar depois", () => {
  it('não diz "não dá para voltar" para o item com volta depois', () => {
    const g = guide();
    const later = structuredClone(g.walkthrough);
    later.chapters[0].steps.flatMap((s) => s.items).find((i) => i.key === "acessorio-boulderguard")!.returnLater = true;
    render(<WalkthroughPage guide={{ ...g, walkthrough: later }} />);
    const chapter = document.getElementById("cap-cap-1")!;
    const warnings = within(chapter).getAllByRole("complementary", { name: "Aviso de perdível" });
    const boulder = warnings.find((w) => w.textContent?.includes("Boulderguard"))!;
    expect(boulder).toHaveTextContent("(dá para voltar depois)");
    expect(boulder).not.toHaveTextContent("não dá para voltar");
    expect(boulder).not.toHaveTextContent("Prazo");
    const legado = warnings.find((w) => w.textContent?.includes("Legado"))!;
    expect(legado).toHaveTextContent("Pegue agora: depois não dá para voltar.");
    // End of the chapter: under "Dá para voltar depois", not under "Não volta".
    const end = within(chapter).getByRole("complementary", { name: "O que dá para pegar depois" });
    const lost = [...end.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Não volta"))!;
    expect(lost).not.toHaveTextContent("Boulderguard");
    expect(lost).toHaveTextContent("Legado");
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

  it("o foco vai para o título da página", async () => {
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("scrollTo", vi.fn());
    render(
      <>
        <h1>Phantom Blade Zero</h1>
        <BackToTop />
      </>,
    );
    await scrollTo(2000);
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao topo" }));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("no celular sobe acima do player da trilha; no computador (player à esquerda) fica no canto", async () => {
    vi.stubGlobal("innerHeight", 1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      // The mini player at the bottom left: 358 px wide (most of a phone), 50 px tall, 16 px up.
      if (this.classList.contains("wk-ost"))
        return { left: 16, right: 374, top: 934, bottom: 984, width: 358, height: 50 } as DOMRect;
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    });
    vi.stubGlobal("innerWidth", 390);
    const { unmount } = render(
      <>
        <div className="wk-ost" />
        <BackToTop />
      </>,
    );
    await scrollTo(2000);
    // 1000 - 934 + 8: clear of the player.
    expect(screen.getByRole("button", { name: "Voltar ao topo" }).style.bottom).toBe("74px");
    unmount();

    vi.stubGlobal("innerWidth", 1280);
    render(
      <>
        <div className="wk-ost" />
        <BackToTop />
      </>,
    );
    await scrollTo(2000);
    expect(screen.getByRole("button", { name: "Voltar ao topo" }).style.bottom).toBe("16px");
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
