import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Walkthrough, WalkItem } from "@/lib/content/walkthrough-schema";
import { BackdropFader } from "./BackdropFader";
import { kindLabel } from "./kinds";
import { WalkUserSeed } from "./progress";
import { pbzGuide, shipped, walkthrough } from "./walk.test-util";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/app/jogos/[slug]/guia/actions", () => ({ toggleItem: vi.fn(), checkGameAchievements: vi.fn() }));
vi.mock("@/components/fx/reward-bus", () => ({ announceReward: vi.fn(), announceToast: vi.fn() }));
vi.mock("@/components/guide/reveal-achievement", () => ({ revealAchievement: vi.fn(async () => null) }));
vi.mock("./reveal-spoilers", () => ({ revealWalkSpoilers: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(async () => null) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** The example item with the English collectible type the robot writes (Phantom Blade Zero). */
const ENGLISH: Record<string, string> = {
  "sino-lady-rift": "Bell",
  "arma-sanguine-twin": "Bell",
  "missao-triple-threat": "Tales",
  "acessorio-hunters-insight": "Accessory",
  "acessorio-battle-wraps": "Accessory",
  "acessorio-boulderguard": "Accessory",
  "fragmento-ambar-1": "Memory Flower",
  "fragmento-pedra-negra-1": "Blackstone Fragment",
};

function english(item: WalkItem, suffix: string): WalkItem {
  const type = ENGLISH[item.key];
  return { ...item, key: `${item.key}${suffix}`, ...(type ? { kind: "collectible" as const, collectibleType: type } : {}) };
}

/** Three chapters (the example's region three times, keys apart), the last one in the cleanup phase. */
const TITLES = ["Weeping Creek Valley", "Crimson Forest", "Limpeza nº 1"];
const three: Walkthrough = {
  ...walkthrough,
  chapters: TITLES.map((title, c) => {
    const base = walkthrough.chapters[0];
    const suffix = c === 0 ? "" : `-${c + 1}`;
    return {
      ...base,
      key: `cap-${c + 1}`,
      title,
      phaseKey: c === 2 ? "limpeza" : base.phaseKey,
      steps: base.steps.map((step) => ({ ...step, key: `${step.key}${suffix}`, items: step.items.map((i) => english(i, suffix)) })),
    };
  }),
};

function guide() {
  const base = pbzGuide();
  return {
    ...base,
    walkthrough: three,
    steps: [...base.steps, { ...base.steps[0], id: "s2", key: "limpeza", order: 1, title: "Limpeza" }],
  };
}

describe("rótulos dos tipos de coletável (inglês, só a última palavra)", () => {
  it.each([
    ["Bell", "Bells"],
    ["Memory Flower", "Memory Flowers"],
    ["Accessory", "Accessories"],
    ["Blackstone Fragment", "Blackstone Fragments"],
    ["Tales", "Tales"],
    ["Weapons", "Weapons"],
    ["Challenge Location", "Challenge Locations"],
    ["Key", "Keys"],
    ["Box", "Boxes"],
    ["Boss", "Bosses"],
    ["Torch", "Torches"],
    ["Ash Bush", "Ash Bushes"],
  ])("%s → %s", (kind, plural) => {
    expect(kindLabel(kind, 2)).toBe(plural);
    expect(kindLabel(kind, 1)).toBe(kind);
  });

  it("cena e quadro do capítulo usam o plural inglês, e o singular quando é 1", () => {
    const { container } = render(<WalkthroughPage guide={guide()} />);
    const scene = container.querySelector("#cap-cap-2 .wk-scene") as HTMLElement;
    const meta = within(scene).getAllByRole("listitem").map((li) => li.textContent);
    expect(meta).toEqual(expect.arrayContaining(["3 Accessories", "2 Bells", "1 Tales"]));
    const box = screen.getByRole("complementary", { name: "Resumo de Crimson Forest" });
    const rows = [...box.querySelectorAll(".wk-cnt")].map((p) => p.textContent);
    expect(rows).toEqual(
      expect.arrayContaining(["Accessories3", "Bells2", "Memory Flower1", "Tales1", "Blackstone Fragment1"]),
    );
    expect(container.textContent).not.toMatch(/Belis|Accessorys|Taleses|Memorys|Blackstones/);
  });
});

describe("linha do tempo antes de cada capítulo", () => {
  const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".wk-jgap")];

  it("aparece antes da cena a partir do capítulo 2, com o capítulo que começa como atual", async () => {
    const { container } = render(
      <WalkthroughPage guide={guide()} user={<WalkUserSeed doneRefs={["sino-lady-rift"]} unlockedIds={[]} unlockedCount={0} pendingXp={0} />} />,
    );
    const gaps = rows(container);
    expect(gaps).toHaveLength(2);
    expect(container.querySelector("#cap-cap-1 .wk-jgap")).toBeNull();

    const [before2, before3] = gaps;
    const scene3 = container.querySelector("#cap-cap-3 .wk-scene")!;
    const lastStep2 = [...container.querySelectorAll("#cap-cap-2 .wk-step")].at(-1)!;
    expect(before3.compareDocumentPosition(scene3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lastStep2.compareDocumentPosition(before3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const items = before3.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveClass("p");
    expect(items[1]).toHaveClass("p");
    expect(items[2]).toHaveClass("c");
    expect(items[2]).not.toHaveClass("p");
    expect(items[2]).toHaveClass("ph");
    expect(within(items[2]).getByRole("link")).toHaveAttribute("aria-current", "step");
    // The visitor's resume point is in chapter 1: its diamond goes there, not to the chapter start.
    await waitFor(() => expect(items[0]).toHaveClass("here"));
    expect([...before3.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "#item-missao-triple-threat",
      "#cap-cap-2",
      "#cap-cap-3",
    ]);
    expect(before2.querySelectorAll("li")[1]).toHaveClass("c");
    expect(before2.querySelectorAll("li")[0]).toHaveClass("p");
    expect(before2.querySelectorAll("li")[2]).not.toHaveClass("p");

    // The visitor's ticks and the missables, as in the top row.
    await waitFor(() => expect(before2.querySelectorAll("li")[0]).toHaveTextContent(/^Weeping Creek Valley1\/10/));
    expect(before2).toHaveTextContent("2 ⚠");
    // The top row is still the one "Capítulos do detonado".
    expect(screen.getAllByRole("navigation", { name: "Capítulos do detonado" })).toHaveLength(1);
  });

  it("os capítulos vão para o navegador uma vez só (cada linha leva só o seu número)", () => {
    const out = shipped(<WalkthroughPage guide={guide()} />);
    expect(out.filter((s) => s.includes('"chapters":[{"key":"cap-1"'))).toHaveLength(1);
    expect(out).toContain('{"at":1}');
    expect(out).toContain('{"at":2}');
  });

  it("no celular a linha rola de lado até o capítulo que começa", async () => {
    const set = vi.fn();
    // HTMLElement.prototype has no scrollLeft of its own (Element has): shadow it, then drop it.
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, "scrollLeft", { configurable: true, get: () => 0, set });
    vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "OL") return { left: 0, width: 390, top: 0, right: 390, bottom: 60, height: 60 } as DOMRect;
      if (this.tagName === "LI") {
        const i = [...this.parentElement!.children].indexOf(this);
        return { left: i * 120, width: 120, top: 0, right: i * 120 + 120, bottom: 60, height: 60 } as DOMRect;
      }
      return { left: 0, width: 0, top: 0, right: 0, bottom: 0, height: 0 } as DOMRect;
    });
    try {
      render(<WalkthroughPage guide={guide()} />);
      await act(async () => {});
      // Third chapter (left 240, width 120) centred in 390 px: 240 - (390 - 120) / 2.
      expect(set).toHaveBeenCalledWith(105);
    } finally {
      delete (proto as unknown as Record<string, unknown>).scrollLeft;
    }
  });
});

describe("BackdropFader por capítulo", () => {
  const SHOTS = ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg", "https://cdn.example/3.jpg", "https://cdn.example/4.jpg"];
  const media = (reduce: boolean) => (query: string) => ({ matches: reduce && query.includes("reduce"), media: query });
  /** Chapter c (0-based) runs from 1000·c to 1000·c + 900 on the page; the window is 1000 px tall. */
  const CHAPTER = 1000;
  const LENGTH = 900;

  function Chapters() {
    return (
      <>
        {[0, 1, 2].map((c) => (
          <section key={c} className="wk-chap" id={`cap-${c}`} data-c={c}>
            <header className="wk-scene" />
            <article className="wk-step" />
            <article className="wk-step" />
          </section>
        ))}
      </>
    );
  }

  function geometry() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const section = this.closest<HTMLElement>(".wk-chap");
      const c = Number(section?.dataset.c ?? 0);
      const steps = section ? [...section.querySelectorAll(".wk-step")] : [];
      let top = c * CHAPTER;
      let bottom = top + LENGTH;
      if (this.classList.contains("wk-scene")) bottom = top + 300;
      else if (this.classList.contains("wk-step")) {
        const i = steps.indexOf(this);
        top = c * CHAPTER + 300 + i * 300;
        bottom = top + 300;
      }
      const y = window.scrollY;
      return { top: top - y, bottom: bottom - y, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect;
    });
  }

  /** Scroll so the reading line (55% of the window) sits at `at` px of the page. */
  async function readAt(at: number) {
    Object.defineProperty(window, "scrollY", { configurable: true, value: at - window.innerHeight * 0.55 });
    fireEvent.scroll(window);
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }

  const on = (container: HTMLElement) =>
    [...container.querySelectorAll(".wk-bgfx i")].findIndex((layer) => layer.classList.contains("on"));

  it("dentro do capítulo 2 a foto troca, e volta para a primeira no começo do capítulo 3", async () => {
    vi.stubGlobal("matchMedia", media(false));
    vi.stubGlobal("innerHeight", 1000);
    geometry();
    const { container } = render(
      <>
        <BackdropFader images={SHOTS} />
        <Chapters />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll(".wk-bgfx i")).toHaveLength(4));
    await readAt(CHAPTER + 50);
    expect(on(container)).toBe(0);
    await readAt(CHAPTER + 500);
    expect(on(container)).toBe(2);
    await readAt(CHAPTER + 880);
    expect(on(container)).toBe(3);
    await readAt(2 * CHAPTER + 20);
    expect(on(container)).toBe(0);
    await readAt(2 * CHAPTER + 300);
    expect(on(container)).toBe(1);
    // Parallax still bounded by 70 px.
    const layer = container.querySelector(".wk-bgfx i") as HTMLElement;
    const drift = Number(/translateY\((-?[\d.]+)px\)/.exec(layer.style.transform)?.[1]);
    expect(Math.abs(drift)).toBeLessThanOrEqual(70);
  });

  it("reduced motion: só a primeira foto, sem troca dentro do capítulo", async () => {
    vi.stubGlobal("matchMedia", media(true));
    vi.stubGlobal("innerHeight", 1000);
    geometry();
    const { container } = render(
      <>
        <BackdropFader images={SHOTS} />
        <Chapters />
      </>,
    );
    await readAt(CHAPTER + 500);
    const layers = container.querySelectorAll(".wk-bgfx i");
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveClass("on");
  });
});
