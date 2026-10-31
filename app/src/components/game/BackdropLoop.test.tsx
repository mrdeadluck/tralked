import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackdropLoop } from "./BackdropLoop";

let quiet = false;
let saveData = false;
let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
const play = vi.fn(async () => undefined);
const pause = vi.fn();

beforeEach(() => {
  quiet = false;
  saveData = false;
  observed = null;
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: quiet, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData }) });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observed = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  play.mockClear();
  pause.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.getElementById("gp-root")?.remove();
});

const FILE = {
  kind: "file" as const,
  sources: ["https://video.akamai.steamstatic.com/store_trailers/1/movie480.mp4", "https://video.akamai.steamstatic.com/store_trailers/1/movie_max.mp4"],
  poster: null,
};

function mount(video: Parameters<typeof BackdropLoop>[0]["video"] = FILE) {
  const root = document.createElement("div");
  root.id = "gp-root";
  document.body.append(root);
  return { root, ...render(<BackdropLoop video={video} gameName="Hollow Knight" />, { container: root.appendChild(document.createElement("div")) }) };
}

const onScreen = (visible: boolean) => act(() => observed?.([{ isIntersecting: visible }]));

describe("BackdropLoop", () => {
  it("requests nothing until the banner is on screen, then plays muted and pauses off screen", () => {
    const { container } = mount();
    expect(container.querySelector("video")).toBeNull();
    onScreen(true);
    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect([...video.querySelectorAll("source")].map((s) => s.getAttribute("src"))).toEqual(FILE.sources);
    expect(play).toHaveBeenCalled();
    onScreen(false);
    expect(pause).toHaveBeenCalled();
  });

  it("waits for the case intro to end", async () => {
    const { root, container } = mount();
    root.setAttribute("data-intro", "stage");
    onScreen(true);
    expect(container.querySelector("video")).toBeNull();
    await act(async () => {
      root.removeAttribute("data-intro");
      await new Promise((r) => setTimeout(r, 0)); // MutationObserver callback
    });
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("is off with reduced motion / reduced data, and with Save-Data", () => {
    quiet = true;
    expect(mount().container.querySelector("[data-testid=backdrop-loop]")).toBeNull();
    cleanup();
    document.getElementById("gp-root")?.remove();
    quiet = false;
    saveData = true;
    expect(mount().container.querySelector("[data-testid=backdrop-loop]")).toBeNull();
  });

  it("has a pause button once it plays, remembered on this device", () => {
    const { container } = mount();
    onScreen(true);
    fireEvent(container.querySelector("video")!, new Event("playing"));
    fireEvent.click(screen.getByRole("button", { name: "Pausar o vídeo de fundo" }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retomar o vídeo de fundo" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("tralked:backdrop:paused")).toBe("1");
  });

  it("falls back to a privacy-enhanced, muted, looping YouTube embed", () => {
    const { container } = mount({ kind: "youtube", youtubeId: "dQw4w9WgXcQ" });
    onScreen(true);
    const frame = container.querySelector("iframe")!;
    const src = new URL(frame.src);
    expect(src.origin).toBe("https://www.youtube-nocookie.com");
    expect(Object.fromEntries(src.searchParams)).toMatchObject({ mute: "1", loop: "1", playlist: "dQw4w9WgXcQ", controls: "0", autoplay: "1" });
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame.closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("renders nothing without a trailer", () => {
    expect(mount(null).container.innerHTML).toBe("");
  });
});
