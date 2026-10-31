import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameAttributes } from "@/lib/queries/game-profile";
import { AttributesGained } from "./AttributesGained";
import { CaseIntro } from "./CaseIntro";

const markOpened = vi.fn(async (gameId: unknown) => ({ status: "ok" as const, gameId }));
vi.mock("@/app/jogos/[slug]/actions", () => ({ markOpened: (id: unknown) => markOpened(id) }));

let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  localStorage.clear();
  markOpened.mockClear();
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

function renderIntro(account: { opened: boolean } | null = null) {
  const root = document.createElement("div");
  root.id = "gp-root";
  root.setAttribute("data-intro", "pending");
  document.body.append(root);
  render(
    <CaseIntro
      gameId="game-1"
      slug="hollow-knight"
      name="Hollow Knight"
      hues={[218, 250]}
      seed={7}
      coverUrl={null}
      discArt={null}
      platformLabel="PC · STEAM"
      discLabel="TRALKED · DISCO 1"
      plat={false}
      bookletNote="Guia de conquistas 100%"
      account={account}
    />,
  );
  return { root, stage: screen.getByTestId("case-intro") };
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

  it("Esc also skips", () => {
    const { stage } = renderIntro();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(stage).not.toHaveClass("gpc-on");
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("second visit on this browser: no case", () => {
    localStorage.setItem(KEY, "1");
    const { root, stage } = renderIntro();
    expect(stage).not.toHaveClass("gpc-on");
    expect(root).not.toHaveAttribute("data-intro");
  });

  it("opened on another device (account): no case, and this browser learns it", () => {
    const { stage } = renderIntro({ opened: true });
    expect(stage).not.toHaveClass("gpc-on");
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(markOpened).not.toHaveBeenCalled();
  });

  it("reduced motion: never shows the case, records the first visit", () => {
    reduceMotion = true;
    const { root, stage } = renderIntro({ opened: false });
    expect(stage).not.toHaveClass("gpc-on");
    expect(root).not.toHaveAttribute("data-intro");
    expect(markOpened).toHaveBeenCalledWith("game-1");
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
    render(<AttributesGained attributes={attrs} loggedIn genre="Soulslike" aside="Steam · 141 h jogadas" loginHref="/login" />);
    expect(screen.getByText("120k")).toBeInTheDocument();
    expect(screen.getByText("+286")).toBeInTheDocument();
    expect(screen.getByText("141 horas jogadas viram resistência.")).toBeInTheDocument();
    expect(screen.getByText("+3 níveis vieram deste jogo.")).toBeInTheDocument();
    expect(screen.getByText("Steam · 141 h jogadas")).toBeInTheDocument();
  });

  it("logged out: explains each rule and links to login", () => {
    render(<AttributesGained attributes={null} loggedIn={false} genre="Soulslike" aside={null} loginHref="/login" />);
    expect(screen.getAllByText("—")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Entre para ver os seus" })).toHaveAttribute("href", "/login");
  });
});
