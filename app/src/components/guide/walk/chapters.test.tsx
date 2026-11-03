import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { checkGameAchievements, toggleItem } from "@/app/jogos/[slug]/guia/actions";
import { announceReward } from "@/components/fx/reward-bus";
import type { GuideReport } from "@/lib/admin/guide-report";
import { getSessionUser } from "@/lib/auth/session";
import { gatedRef } from "@/lib/content/walk-refs";
import { BackdropFader } from "./BackdropFader";
import { WalkProgressProvider, WalkUserSeed, type WalkUserSeedData } from "./progress";
import { revealWalkSpoilers } from "./reveal-spoilers";
import { RobotReport } from "./RobotReport";
import { SoundtrackPlayer } from "./SoundtrackPlayer";
import { SpoilerProvider } from "./spoilers";
import { walkSpoilers, walkView, type ItemView } from "./view";
import { ach, pbzGuide, shipped, walkthrough } from "./walk.test-util";
import { WalkItemRow } from "./WalkItemRow";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/app/jogos/[slug]/guia/actions", () => ({ toggleItem: vi.fn(), checkGameAchievements: vi.fn() }));
vi.mock("@/components/fx/reward-bus", () => ({ announceReward: vi.fn(), announceToast: vi.fn() }));
vi.mock("@/components/guide/reveal-achievement", () => ({ revealAchievement: vi.fn(async () => null) }));
vi.mock("./reveal-spoilers", () => ({ revealWalkSpoilers: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(async () => null) }));

const REPORT: GuideReport = {
  sourcesRead: [
    { name: "PowerPyx", url: "https://www.powerpyx.com/", ok: true, reason: null },
    { name: "Fórum", url: null, ok: false, reason: "página de desafio" },
  ],
  divergences: ["O PowerPyx diz 23 sinos e lista 22."],
  singleSource: ["Boulderguard: só o PowerPyx cita."],
  coverage: { steam: 66, covered: 36, steamOnly: 30 },
  spendUsd: 1.2,
};

vi.mock("@/lib/queries/games", async (original) => ({
  ...(await original<typeof import("@/lib/queries/games")>()),
  loadGuideReport: vi.fn(async () => REPORT),
}));

/** The guide with the boss's achievement hidden on Steam, as the real Phantom Blade Zero list has it. */
function guide() {
  const base = pbzGuide();
  return {
    ...base,
    walkthrough: { ...walkthrough, soundtrack: { youtubeId: "abcdefghijk", title: "Phantom Blade Zero OST", channel: "S-GAME" } },
    walk: { ...base.walk!, screenshots: ["https://cdn.example/ss1.jpg", "https://cdn.example/ss2.jpg"] },
  };
}

const view = walkView(walkthrough, pbzGuide().walk!, ["ate-mirage-estate"]);
const itemsOf = () => view.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
const item = (ref: string): ItemView => itemsOf().find((i) => i.ref === ref)!;

const SEED: WalkUserSeedData = { doneRefs: [], unlockedIds: [], unlockedCount: 15, pendingXp: 150 };

function Page({ children, seed = SEED }: { children: ReactNode; seed?: WalkUserSeedData | null }) {
  return (
    <WalkProgressProvider guideId="guide-pbz" gameId="game-pbz" returnTo="/jogos/phantom-blade-zero/guia">
      <SpoilerProvider guideId="guide-pbz">
        {seed ? <WalkUserSeed {...seed} /> : null}
        {children}
      </SpoilerProvider>
    </WalkProgressProvider>
  );
}

const LEGADO = "conquista-legado-curandeira";
const NOTHING_NEW = { status: "ok" as const, newUnlocks: [], reward: null };

beforeEach(() => {
  vi.mocked(toggleItem).mockResolvedValue({ status: "ok", done: true });
  vi.mocked(checkGameAchievements).mockResolvedValue(NOTHING_NEW);
  vi.mocked(revealWalkSpoilers).mockImplementation(async () =>
    walkSpoilers(walkthrough, {
      ACH_SCARLET_SPECTRAL_BLADE: { name: "Lâmina Espectral Escarlate", description: "Derrote Hua.", iconUrl: null, hidden: true },
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("WalkItemRow", () => {
  it("marcar conquista confirmada chama announceReward", async () => {
    vi.mocked(checkGameAchievements).mockResolvedValue({
      status: "ok",
      newUnlocks: [{ id: "id-ACH_HEALER_LEGACY", apiName: "ACH_HEALER_LEGACY", name: "Legado da Curandeira", iconUrl: null }],
      reward: { xpGained: 50, reason: "Conquista" },
    });
    render(
      <Page>
        <WalkItemRow item={item(LEGADO)} />
      </Page>,
    );
    const box = screen.getByRole("checkbox", { name: /Legado da Curandeira/ });
    fireEvent.click(box);
    await waitFor(() => expect(announceReward).toHaveBeenCalledWith(expect.objectContaining({ xpGained: 50, reason: "TRALKED!" })));
    expect(toggleItem).toHaveBeenCalledWith("guide-pbz", LEGADO);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("✓ Confirmada pela Steam")).toBeInTheDocument();
  });

  it("conquista não confirmada mostra aguardando e agenda nova conferência", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    render(
      <Page>
        <WalkItemRow item={item(LEGADO)} />
      </Page>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Legado da Curandeira/ }));
    expect(await screen.findByText("marcada por você · a Steam ainda não mostrou")).toBeInTheDocument();
    expect(checkGameAchievements).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(checkGameAchievements).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(checkGameAchievements).toHaveBeenCalledTimes(3);
    // The manual tick itself never pays anything.
    expect(announceReward).not.toHaveBeenCalled();
  });

  it("unlinked mostra convite", async () => {
    vi.mocked(checkGameAchievements).mockResolvedValue({ status: "unlinked", newUnlocks: [], reward: null });
    render(
      <Page>
        <WalkItemRow item={item(LEGADO)} />
      </Page>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Legado da Curandeira/ }));
    expect(await screen.findByRole("link", { name: "Ligue sua Steam para conferir" })).toHaveAttribute("href", "/conta/conexoes");
    // Still a checklist: the tick stays.
    expect(screen.getByRole("checkbox", { name: /Legado da Curandeira/ })).toHaveAttribute("aria-checked", "true");
    expect(announceReward).not.toHaveBeenCalled();
  });

  it("visitante sem login recebe convite para entrar e nada é gravado", () => {
    render(
      <Page seed={null}>
        <WalkItemRow item={item(LEGADO)} />
      </Page>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Legado da Curandeira/ }));
    expect(screen.getByRole("link", { name: "Entre para marcar" })).toHaveAttribute(
      "href",
      "/entrar?returnTo=%2Fjogos%2Fphantom-blade-zero%2Fguia",
    );
    expect(toggleItem).not.toHaveBeenCalled();
  });

  it("selos, fontes e crédito da imagem", () => {
    render(
      <Page>
        <WalkItemRow item={item("acessorio-hunters-insight")} />
        <WalkItemRow item={item("fragmento-ambar-1")} />
        <WalkItemRow item={item("acessorio-battle-wraps")} />
      </Page>,
    );
    const [hunter, amber] = screen.getAllByRole("checkbox").map((b) => b.closest(".wk-item") as HTMLElement);
    expect(hunter).toHaveTextContent("dá para voltar depois");
    expect(hunter).toHaveTextContent("acessório 1/30");
    expect(hunter).toHaveTextContent("✓ 2 fontes");
    expect(within(hunter).getByRole("link", { name: "Steam" })).toHaveAttribute("href", "https://store.steampowered.com/app/4115450/");
    expect(hunter.querySelector("figcaption")).toHaveTextContent("Imagem: Steam");
    expect(amber).toHaveTextContent("● 2 fontes · em revisão");
  });
});

describe("WalkthroughPage (detonado)", () => {
  it("item perdível mostra selo e o aviso vem antes do passo", () => {
    render(<WalkthroughPage guide={guide()} />);
    const row = screen.getByRole("checkbox", { name: /Boulderguard/ }).closest(".wk-item") as HTMLElement;
    expect(row).toHaveTextContent("perdível · pegue agora");
    const step = row.closest("article")!;
    const warning = screen
      .getAllByRole("complementary", { name: "Aviso de perdível" })
      .find((w) => w.textContent?.includes("Boulderguard"))!;
    expect(warning).toHaveTextContent("Prazo: Antes do chefe principal da Crimson Forest");
    expect(warning.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(step.contains(warning)).toBe(false);
  });

  it("jornada conta os itens marcados do visitante", async () => {
    render(<WalkthroughPage guide={guide()} user={<WalkUserSeed {...SEED} doneRefs={[LEGADO, "sino-lady-rift"]} />} />);
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    expect(await within(journey).findByText(/^2\/10/)).toBeInTheDocument();
    expect(journey).toHaveTextContent("2 ⚠");
  });

  it('nenhum texto contém "platina"', async () => {
    const { container } = render(
      <WalkthroughPage guide={guide()} user={<WalkUserSeed {...SEED} />} report={<RobotReport report={REPORT} staff />} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Spoilers/ })[0]);
    expect(await screen.findAllByText("Chefe opcional · Hua, a Noiva Mortal")).not.toHaveLength(0);
    expect(container.textContent).not.toMatch(/platina/i);
  });
});

describe("spoilers fora da página (R13, R16)", () => {
  it("boss com spoiler e aviso do leia-antes não chegam ao navegador com spoilers desligados", () => {
    const g = guide();
    const secret = { ...ach("ACH_SCARLET_SPECTRAL_BLADE", null, 67.1, true), id: "cm-hidden-1" };
    const withCallout = structuredClone(g.walkthrough);
    withCallout.chapters[0].steps[6].body.push({ type: "callout", tone: "spoiler", text: "O Posto Avançado é atacado no fim da região." });
    // Inline spoilers in a read-first note, a list item and a visible item's location.
    withCallout.readFirst[0].text = "Salve antes de ||o Imperador Caído|| aparecer.";
    (withCallout.chapters[0].steps[6].body[2] as { items: string[] }).items[0] = "Fale com ||o traidor Wen||.";
    withCallout.chapters[0].steps[6].items[0].location = "Atrás do túmulo de ||Mestre Lan||.";
    const out = shipped(
      <WalkthroughPage
        guide={{
          ...g,
          walkthrough: withCallout,
          walk: { ...g.walk, achievements: { ...g.walk.achievements, ACH_SCARLET_SPECTRAL_BLADE: secret } },
        }}
      />,
    ).join(" ");
    // The boss, also where the step's text names it inline (||…||).
    expect(out).not.toContain("Hua, a Noiva Mortal");
    expect(out).not.toContain("Noiva Mortal");
    expect(out).not.toContain("Imperador Caído");
    expect(out).not.toContain("traidor Wen");
    expect(out).not.toContain("Mestre Lan");
    // The spoiler boss item: name, key, location and its hidden achievement.
    expect(out).not.toContain("Chefe opcional · Hua");
    expect(out).not.toContain("boss-hua-noiva-mortal");
    expect(out).not.toContain("A vitória também dá a arma");
    expect(out).not.toContain("ACH_SCARLET_SPECTRAL_BLADE");
    expect(out).not.toContain("Lâmina Espectral Escarlate");
    // The read-first note marked as spoiler, and a spoiler callout of a step.
    expect(out).not.toContain("todas as missões com ícone roxo");
    expect(out).not.toContain("O Posto Avançado é atacado");
    // What does travel: the gated item's opaque ref.
    expect(out).toContain(gatedRef("boss-hua-noiva-mortal"));
  });

  it("ligar os spoilers busca o texto e o item com spoiler marca pela ref opaca", async () => {
    render(<WalkthroughPage guide={guide()} user={<WalkUserSeed {...SEED} />} />);
    expect(screen.queryByText("Chefe opcional · Hua, a Noiva Mortal")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Spoilers/ })[0]);
    const boss = await screen.findByRole("checkbox", { name: "Marcar Chefe opcional · Hua, a Noiva Mortal como feito" });
    expect(revealWalkSpoilers).toHaveBeenCalledWith("guide-pbz");
    expect(boss.closest(".wk-item")).toHaveTextContent("A vitória também dá a arma");
    fireEvent.click(boss);
    await waitFor(() => expect(toggleItem).toHaveBeenCalledWith("guide-pbz", gatedRef("boss-hua-noiva-mortal")));
    // The boss named inline in the step's text shows too.
    expect(screen.getByRole("article", { name: "Passo 1.9" }).querySelector(".wk-txt")).toHaveTextContent(
      "Ali você enfrenta Hua, a Noiva Mortal.",
    );
  });

  it("spoiler no meio do texto abre sozinho com mostrar", async () => {
    render(<WalkthroughPage guide={guide()} />);
    const text = screen.getByRole("article", { name: "Passo 1.9" }).querySelector(".wk-txt") as HTMLElement;
    expect(text).toHaveTextContent("Ali você enfrenta");
    expect(text).not.toHaveTextContent("Noiva Mortal");
    fireEvent.click(within(text).getByRole("button", { name: "Mostrar o trecho com spoiler" }));
    expect(await within(text).findByText("Hua, a Noiva Mortal")).toBeInTheDocument();
    // Only this span: the boss item below stays closed.
    expect(screen.queryByText("Chefe opcional · Hua, a Noiva Mortal")).toBeNull();
  });
});

describe("SoundtrackPlayer", () => {
  type FakeOptions = {
    width: number;
    height: number;
    events: { onReady: (e: { target: FakePlayer }) => void; onStateChange: (e: { data: number }) => void };
  };
  type FakePlayer = { setVolume: Mock; playVideo: Mock; pauseVideo: Mock; destroy: Mock };

  /** The IFrame API: the player gets ready and starts playing at once, like a fast connection. */
  function fakeYouTube() {
    const player: FakePlayer = { setVolume: vi.fn(), playVideo: vi.fn(), pauseVideo: vi.fn(), destroy: vi.fn() };
    let options: FakeOptions | null = null;
    const Player = vi.fn(function (this: unknown, el: HTMLElement, opts: FakeOptions) {
      options = opts;
      el.replaceWith(document.createElement("iframe"));
      opts.events.onReady({ target: player });
      opts.events.onStateChange({ data: 1 });
      return player;
    });
    (window as unknown as { YT: unknown }).YT = { Player };
    const state = (data: number) => act(() => options!.events.onStateChange({ data }));
    return { Player, player, state };
  }

  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
    vi.unstubAllGlobals();
  });

  const OST = { youtubeId: "abcdefghijk", title: "Phantom Blade Zero OST", channel: "S-GAME" };
  const video = () => document.querySelector<HTMLElement>(".wk-ost-video");

  it("player não cria iframe antes do primeiro clique e usa volume 8", async () => {
    const { Player, player } = fakeYouTube();
    render(<SoundtrackPlayer soundtrack={OST} />);
    expect(await screen.findByRole("region", { name: "Trilha sonora do jogo" })).toHaveTextContent("Phantom Blade Zero OST");
    expect(Player).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(video()).not.toBeVisible();

    fireEvent.click(document.body);
    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));
    expect(Player.mock.calls[0][1]).toMatchObject({ host: "https://www.youtube-nocookie.com", videoId: "abcdefghijk" });
    expect(player.setVolume).toHaveBeenCalledWith(8);
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  it("tocando, o player do YouTube fica visível com pelo menos 200 × 200; pausar recolhe, fechar tira", async () => {
    const { Player, player, state } = fakeYouTube();
    render(<SoundtrackPlayer soundtrack={OST} />);
    await screen.findByRole("region", { name: "Trilha sonora do jogo" });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pausar a trilha" })).toBeInTheDocument());

    const frame = video()!;
    expect(frame).toBeVisible();
    expect(frame.querySelector("iframe")).toBeVisible();
    expect(parseFloat(frame.style.width)).toBeGreaterThanOrEqual(200);
    expect(parseFloat(frame.style.height)).toBeGreaterThanOrEqual(200);
    const { width, height } = Player.mock.calls[0][1] as FakeOptions;
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(200);

    fireEvent.click(screen.getByRole("button", { name: "Pausar a trilha" }));
    expect(player.pauseVideo).toHaveBeenCalled();
    await state(2);
    expect(frame).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Tocar a trilha" })).toBeInTheDocument();

    // Playing again shows the video before the sound comes back.
    fireEvent.click(screen.getByRole("button", { name: "Tocar a trilha" }));
    expect(frame).toBeVisible();
    expect(player.playVideo).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Fechar a trilha" }));
    expect(player.destroy).toHaveBeenCalled();
    expect(video()).toBeNull();
  });

  it("no celular só toca pelo botão ▶; fechar fica salvo", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("coarse"), media: query }));
    const { Player } = fakeYouTube();
    const { unmount } = render(<SoundtrackPlayer soundtrack={OST} />);
    await screen.findByRole("region", { name: "Trilha sonora do jogo" });
    fireEvent.click(document.body);
    expect(Player).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tocar a trilha" }));
    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Fechar a trilha" }));
    expect(screen.queryByRole("region", { name: "Trilha sonora do jogo" })).toBeNull();
    unmount();
    render(<SoundtrackPlayer soundtrack={OST} />);
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Trilha sonora do jogo" })).toBeNull();
  });

  // Last: it leaves the module's API loader waiting on the (fake) script.
  it("fechar enquanto a API do YouTube carrega não cria o player", async () => {
    render(<SoundtrackPlayer soundtrack={OST} />);
    await screen.findByRole("region", { name: "Trilha sonora do jogo" });
    fireEvent.click(document.body);
    expect(document.head.querySelector('script[src="https://www.youtube.com/iframe_api"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar a trilha" }));

    const { Player } = fakeYouTube();
    await act(async () => (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady());
    expect(Player).not.toHaveBeenCalled();
  });
});

describe("BackdropFader", () => {
  const SHOTS = ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg", "https://cdn.example/3.jpg", "https://cdn.example/4.jpg"];
  const media = (reduce: boolean) => (query: string) => ({ matches: reduce && query.includes("reduce"), media: query });

  afterEach(() => vi.unstubAllGlobals());

  it("reduced motion: BackdropFader sem troca", async () => {
    vi.stubGlobal("matchMedia", media(true));
    const { container } = render(<BackdropFader images={SHOTS} />);
    await act(async () => {});
    fireEvent.scroll(window);
    const layers = container.querySelectorAll(".wk-bgfx i");
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveClass("on");
    expect((layers[0] as HTMLElement).style.transform).toBe("");
  });

  it("com movimento, as 4 imagens entram para trocar", async () => {
    vi.stubGlobal("matchMedia", media(false));
    const { container } = render(<BackdropFader images={[...SHOTS, "https://cdn.example/5.jpg"]} />);
    await waitFor(() => expect(container.querySelectorAll(".wk-bgfx i")).toHaveLength(4));
  });
});

describe("RobotReport", () => {
  it("RobotReport não aparece para visitante", async () => {
    const { WalkReportIsland } = await import("@/components/guide/UserIslands");
    expect(await WalkReportIsland({ guideId: "guide-pbz" })).toBeNull();
    vi.mocked(getSessionUser).mockResolvedValueOnce({ id: "u1", handle: "leitor", role: "user" } as never);
    expect(await WalkReportIsland({ guideId: "guide-pbz" })).toBeNull();

    const { container } = render(<RobotReport report={REPORT} staff={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a equipe vê fontes, divergências, fatos de uma fonte e cobertura", async () => {
    const { WalkReportIsland } = await import("@/components/guide/UserIslands");
    vi.mocked(getSessionUser).mockResolvedValueOnce({ id: "u2", handle: "editora", role: "editor" } as never);
    render(<>{await WalkReportIsland({ guideId: "guide-pbz" })}</>);
    const report = screen.getByRole("region", { name: "Relatório do robô" });
    expect(report).toHaveTextContent("PowerPyx");
    expect(report).toHaveTextContent("não lida: página de desafio");
    expect(report).toHaveTextContent("O PowerPyx diz 23 sinos e lista 22.");
    expect(report).toHaveTextContent("Boulderguard: só o PowerPyx cita.");
    expect(report).toHaveTextContent("36 de 66");
  });
});
