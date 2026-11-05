import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileBackdrop } from "./ProfileBackdrop";

let reduceMotion = false;
let visibility: DocumentVisibilityState = "visible";

const URLS = ["https://img/pbz-hero.jpg", "https://img/cv-hero.jpg", "https://img/fc-hero.jpg"];
const shown = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].findIndex((img) => img.className.includes("opacity-45"));

describe("ProfileBackdrop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reduceMotion = false;
    visibility = "visible";
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("reduce") ? reduceMotion : false })),
    );
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the first game's art, then each in turn, back to the first", () => {
    const { container } = render(<ProfileBackdrop urls={URLS} />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(shown(container)).toBe(0);
    act(() => vi.advanceTimersByTime(9_000));
    expect(shown(container)).toBe(1);
    act(() => vi.advanceTimersByTime(18_000));
    expect(shown(container)).toBe(0);
    // Only the first loads at once.
    expect(container.querySelectorAll("img")[0].getAttribute("loading")).toBe("eager");
    expect(container.querySelectorAll("img")[1].getAttribute("loading")).toBe("lazy");
  });

  it("keeps the first still with reduced motion, and does not turn in a hidden tab", () => {
    reduceMotion = true;
    const still = render(<ProfileBackdrop urls={URLS} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(shown(still.container)).toBe(0);
    cleanup();

    reduceMotion = false;
    visibility = "hidden";
    const hidden = render(<ProfileBackdrop urls={URLS} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(shown(hidden.container)).toBe(0);
  });

  it("renders nothing without art", () => {
    const { container } = render(<ProfileBackdrop urls={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});
