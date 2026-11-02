import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameAttributes } from "@/lib/queries/game-profile";
import { AttributesGained } from "./AttributesGained";
import { CaseIntro } from "./CaseIntro";

const markOpened = vi.fn(async (gameId: unknown) => ({ status: "ok" as const, gameId }));
vi.mock("@/app/jogos/[slug]/actions", () => ({ markOpened: (id: unknown) => markOpened(id) }));
const setCaseIntro = vi.fn(async (input: unknown) => ({ ok: true as const, input }));
vi.mock("@/app/conta/actions", () => ({ setCaseIntroAction: (input: unknown) => setCaseIntro(input) }));
const INTRO_OFF = "tralked:case-intro:off";

let reduceMotion = false;

// jsdom has HTMLDialogElement without showModal/show/close: a minimal stand-in that records the mode.
const dialogMode = new WeakMap<HTMLDialogElement, "modal" | "modeless">();
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    dialogMode.set(this, "modal");
  },
  show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    dialogMode.set(this, "modeless");
  },
  close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    dialogMode.delete(this);
    this.dispatchEvent(new Event("close"));
  },
});

beforeEach(() => {
  reduceMotion = false;
  localStorage.clear();
  sessionStorage.clear();
  markOpened.mockClear();
  setCaseIntro.mockClear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") ? reduceMotion : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.stubGlobal("scrollTo", () => {});
  // jsdom has no canvas: the disc and the art keep their CSS fallbacks.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.getElementById("gp-root")?.remove();
  document.body.style.overflow = "";
});

const KEY = "tralked:opened:hollow-knight";

function renderIntro(login: { opened: boolean; introOff?: boolean } | null = null) {
  const account = login ? { opened: login.opened, introOff: login.introOff ?? false } : null;
  const root = document.createElement("div");
  root.id = "gp-root";
  root.setAttribute("data-intro", "pending");
  document.body.append(root);
  const view = render(
    <CaseIntro
      gameId="game-1"
      slug="hollow-knight"
      name="Hollow Knight"
      hues={[218, 250]}
      seed={7}
      coverUrl={null}
      bookletArt={null}
      disc={{ kind: "generated" }}
      platformLabel="PC · STEAM"
      discLabel="TRALKED · DISCO 1"
      plat={false}
      bookletNote="Guia de conquistas 100%"
      account={account}
    />,
  );
  // The stage is portalled into <body> and only mounted for a first visit.
  return { root, stage: screen.queryByTestId("case-intro"), unmount: view.unmount };
}

describe("CaseIntro", () => {
  it("first visit: shows the sealed case, locks the page and focuses the open button", () => {
    const { root, stage } = renderIntro();
    expect(stage).toHaveClass("gpc-on");
    expect(root).toHaveAttribute("data-intro", "stage");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Abrir o lacre" })).toHaveFocus();
  });

  it("Pular reveals the page at once and remembers it (account too)", () => {
    const { root, stage } = renderIntro({ opened: false });
    fireEvent.click(screen.getByRole("button", { name: "Pular" }));
    expect(stage).not.toHaveClass("gpc-on");
    expect(root).not.toHaveAttribute("data-intro");
    expect(document.body.style.overflow).toBe("");
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(markOpened).toHaveBeenCalledWith("game-1");
  });

  it("Esc (the dialog's cancel) also skips", () => {
    const { stage } = renderIntro();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(stage!, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(stage).not.toHaveClass("gpc-on");
    expect(stage).not.toHaveAttribute("open");
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("a dialog the browser closes by itself (non-cancelable Esc) also finishes", () => {
    const { root, stage } = renderIntro();
    (stage as HTMLDialogElement).close();
    expect(stage).not.toHaveClass("gpc-on");
    expect(root).not.toHaveAttribute("data-intro");
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("plays on its own once per session: the next new game of the visit opens at once", () => {
    const first = renderIntro();
    expect(first.stage).toHaveClass("gpc-on");
    fireEvent.click(screen.getByRole("button", { name: "Pular" }));
    first.unmount();
    document.getElementById("gp-root")?.remove();
    localStorage.clear(); // another game: never opened here
    const { root, stage } = renderIntro();
    expect(stage).toBeNull();
    expect(root).not.toHaveAttribute("data-intro");
    // Not marked as opened: a later visit still unseals this game.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("second visit on this browser: the case is not even mounted", () => {
    localStorage.setItem(KEY, "1");
    const { root, stage } = renderIntro();
    expect(stage).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(root).not.toHaveAttribute("data-intro");
  });

  it("opened on another device (account): no case, and this browser learns it", () => {
    const { stage } = renderIntro({ opened: true });
    expect(stage).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(markOpened).not.toHaveBeenCalled();
  });

  it("reduced motion: never shows the case, records the first visit", () => {
    reduceMotion = true;
    const { root, stage } = renderIntro({ opened: false });
    expect(stage).toBeNull();
    expect(root).not.toHaveAttribute("data-intro");
    expect(markOpened).toHaveBeenCalledWith("game-1");
  });

  it("'Não mostrar a animação nos próximos jogos' stays visible during the intro and is saved here and on the account", () => {
    const { stage } = renderIntro({ opened: false });
    const box = screen.getByRole("checkbox", { name: "Não mostrar a animação nos próximos jogos" });
    expect(box).not.toBeChecked();
    // The open button's area fades while the seal opens; the choice is outside it.
    expect(box.closest(".gpc-ui")).toBeNull();
    expect(stage).toContainElement(box);
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(localStorage.getItem(INTRO_OFF)).toBe("1");
    expect(setCaseIntro).toHaveBeenCalledWith({ off: true });
    fireEvent.click(box);
    expect(localStorage.getItem(INTRO_OFF)).toBeNull();
    expect(setCaseIntro).toHaveBeenLastCalledWith({ off: false });
  });

  it("when the account cannot save the choice, the box and this browser go back", async () => {
    setCaseIntro.mockResolvedValueOnce({ ok: false, error: "Entre na sua conta para continuar." } as never);
    renderIntro({ opened: false });
    const box = screen.getByRole("checkbox", { name: "Não mostrar a animação nos próximos jogos" });
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(localStorage.getItem(INTRO_OFF)).toBeNull();
  });

  it("logged out, the choice stays on this browser only", () => {
    renderIntro();
    fireEvent.click(screen.getByRole("checkbox", { name: "Não mostrar a animação nos próximos jogos" }));
    expect(localStorage.getItem(INTRO_OFF)).toBe("1");
    expect(setCaseIntro).not.toHaveBeenCalled();
  });

  it("turned off on this browser: the next game opens without the case, and is recorded as opened", () => {
    localStorage.setItem(INTRO_OFF, "1");
    const { root, stage } = renderIntro();
    expect(stage).toBeNull();
    expect(root).not.toHaveAttribute("data-intro");
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("logged in, the account decides and this browser follows it (re-enabled in /conta elsewhere)", () => {
    localStorage.setItem(INTRO_OFF, "1");
    const first = renderIntro({ opened: false, introOff: false });
    expect(first.stage).toHaveClass("gpc-on");
    expect(localStorage.getItem(INTRO_OFF)).toBeNull();
    first.unmount();
    document.getElementById("gp-root")?.remove();
    localStorage.clear();

    const second = renderIntro({ opened: false, introOff: true });
    expect(second.stage).toBeNull();
    expect(localStorage.getItem(INTRO_OFF)).toBe("1");
    expect(markOpened).toHaveBeenCalledWith("game-1");
  });

  it("opens as a modal <dialog> without touching the page's elements (no inert attributes)", () => {
    const header = document.createElement("header");
    document.body.prepend(header);
    const { root, stage } = renderIntro();
    expect(stage?.tagName).toBe("DIALOG");
    expect(dialogMode.get(stage as HTMLDialogElement)).toBe("modal");
    // The browser makes the rest inert itself: setting attributes on <header>/<main> while the
    // layout may still hydrate caused hydration mismatches.
    expect(header).not.toHaveAttribute("inert");
    expect(root).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Pular" }));
    expect(stage).not.toHaveAttribute("open");
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    header.remove();
  });

  it("long titles break only between words, sized by their longest word", () => {
    const root = document.createElement("div");
    root.id = "gp-root";
    document.body.append(root);
    render(
      <CaseIntro gameId="g" slug="x" name="Supercalifragilisticexpialidocious Edition" hues={[1, 2]} seed={1} coverUrl={null}
        bookletArt={null}
      disc={{ kind: "generated" }} platformLabel="PC" discLabel="D" plat={false} bookletNote="n" account={null} />,
    );
    const titles = screen.getAllByText("Supercalifragilisticexpialidocious Edition");
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(Number(t.style.getPropertyValue("--longest"))).toBeGreaterThan(25);
  });

  it("sound only after the visitor's click: the 6 s auto-open is silent; unmount closes the AudioContext", () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => undefined);
    const created = vi.fn();
    class FakeAudio {
      state = "running";
      currentTime = 0;
      sampleRate = 8000;
      destination = {};
      constructor() {
        created();
      }
      close = close;
      resume = async () => undefined;
      createBuffer = () => ({ getChannelData: () => new Float32Array(8) });
      createBufferSource = () => ({ connect: (n: unknown) => n, start() {} });
      createBiquadFilter = () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect: (n: unknown) => n });
      createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n });
      createOscillator = () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n, start() {}, stop() {} });
    }
    vi.stubGlobal("AudioContext", FakeAudio);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    try {
      const first = renderIntro();
      vi.advanceTimersByTime(6000 + 4000);
      expect(created).not.toHaveBeenCalled();
      first.unmount();
      document.getElementById("gp-root")?.remove();
      localStorage.clear();
      sessionStorage.clear(); // a new visit: the intro may play on its own again

      const second = renderIntro();
      fireEvent.click(screen.getByRole("button", { name: "Abrir o lacre" }));
      expect(created).toHaveBeenCalledTimes(1);
      second.unmount();
      expect(close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AttributesGained", () => {
  const attrs: GameAttributes = {
    xp: 120_400,
    hours: 141,
    vigor: 286,
    precisao: 60,
    rareCount: 2,
    gloria: 710,
    colecao: 250,
    completed: true,
    skill: { id: "soulslike", name: "Soulslike", level: 34, levelsFromGame: 3 },
  };

  it("logged in: what this game added, by attribute", () => {
    render(<AttributesGained attributes={attrs} loggedIn genre="Soulslike" aside="Steam · 141 h jogadas" loginHref="/login" sample={attrs} gameName="Hollow Knight" />);
    // The one XP format of the site (lib/xp-format): "120,4 mil".
    expect(screen.getByText(/^120,4\smil$/)).toBeInTheDocument();
    expect(screen.getByText("+286")).toBeInTheDocument();
    expect(screen.getByText("141 horas jogadas viram resistência.")).toBeInTheDocument();
    expect(screen.getByText("+3 níveis vieram deste jogo.")).toBeInTheDocument();
    expect(screen.getByText("Steam · 141 h jogadas")).toBeInTheDocument();
  });

  it("logged out: the game's own 100% as a hidden sample instead of dashes, and an invitation to sign in", () => {
    const sample = { ...attrs, vigor: 340 };
    render(
      <AttributesGained attributes={null} loggedIn={false} genre="Soulslike" aside={null} loginHref="/login" sample={sample} gameName="Hollow Knight" />,
    );
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.getByText("Veja o seu personagem")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar e conectar" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Entre para ver os seus" })).toHaveAttribute("href", "/login");
    // The sample is only an illustration: out of the accessibility tree.
    expect(screen.getByText("+340").closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("a game without achievements: no sample and no zeros, the hours are what counts", () => {
    render(
      <AttributesGained attributes={null} loggedIn={false} genre={null} aside={null} loginHref="/login" sample={null} gameName="Gravhounds" />,
    );
    expect(screen.getByText("Sem conquistas: aqui vale o tempo jogado")).toBeInTheDocument();
    expect(screen.queryByText("Veja o seu personagem")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("link", { name: "Entrar e conectar" })).toHaveAttribute("href", "/login");
  });
});
