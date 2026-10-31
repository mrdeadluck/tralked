import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackdropLoop, videoType } from "./BackdropLoop";

let quiet = false;
let saveData = false;
let effectiveType = "4g";
let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
const play = vi.fn(async () => undefined);
const pause = vi.fn();

beforeEach(() => {
  quiet = false;
  saveData = false;
  effectiveType = "4g";
  observed = null;
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: quiet, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => ({ saveData, effectiveType }) });
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
  it("only loads metadata until the banner is on screen, then plays muted from 10 s in and pauses off screen", () => {
    const { container } = mount();
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "metadata");
    expect(play).not.toHaveBeenCalled();
    onScreen(true);
    expect(video).toHaveAttribute("preload", "auto");
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect([...video.querySelectorAll("source")].map((s) => [s.getAttribute("src"), s.getAttribute("type")])).toEqual(
      FILE.sources.map((s) => [`${s}#t=10`, "video/mp4"]),
    );
    expect(container.querySelector(".gpb")).not.toHaveAttribute("data-on");
    expect(play).toHaveBeenCalled();
    onScreen(false);
    expect(pause).toHaveBeenCalled();
  });

  it("waits for the case intro to end", async () => {
    const { root } = mount();
    root.setAttribute("data-intro", "stage");
    onScreen(true);
    expect(play).not.toHaveBeenCalled();
    await act(async () => {
      root.removeAttribute("data-intro");
      await new Promise((r) => setTimeout(r, 0)); // MutationObserver callback
    });
    expect(play).toHaveBeenCalled();
  });

  it("is off with reduced motion / reduced data / a narrow screen, Save-Data, and slow connections", () => {
    quiet = true;
    expect(mount().container.querySelector("[data-testid=backdrop-loop]")).toBeNull();
    cleanup();
    document.getElementById("gp-root")?.remove();
    quiet = false;
    saveData = true;
    expect(mount().container.querySelector("[data-testid=backdrop-loop]")).toBeNull();
    cleanup();
    document.getElementById("gp-root")?.remove();
    saveData = false;
    effectiveType = "3g";
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
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      mute: "1",
      loop: "1",
      playlist: "dQw4w9WgXcQ",
      controls: "0",
      autoplay: "1",
      start: "10",
      enablejsapi: "1",
      origin: window.location.origin,
    });
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame.closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("YouTube: says 'listening', waits for the player before commands, fades in only when it really plays", async () => {
    vi.useFakeTimers();
    try {
      const { container } = mount({ kind: "youtube", youtubeId: "dQw4w9WgXcQ" });
      onScreen(true);
      const frame = container.querySelector("iframe")!;
      const posted: string[] = [];
      const win = frame.contentWindow!;
      vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
        posted.push(String(message));
      });
      fireEvent.load(frame);
      expect(JSON.parse(posted[0])).toMatchObject({ event: "listening" });
      onScreen(false); // off screen before the player is ready: the pause must not be lost
      expect(posted.some((m) => m.includes("pauseVideo"))).toBe(false);

      const fromPlayer = (data: unknown) =>
        act(() => {
          window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data), origin: "https://www.youtube-nocookie.com", source: win }));
        });
      fromPlayer({ event: "onReady" });
      expect(JSON.parse(posted.at(-1)!)).toMatchObject({ event: "command", func: "pauseVideo" });
      expect(container.querySelector(".gpb")).not.toHaveAttribute("data-on");
      onScreen(true);
      expect(JSON.parse(posted.at(-1)!)).toMatchObject({ event: "command", func: "playVideo" });
      fromPlayer({ event: "infoDelivery", info: { playerState: 1 } });
      expect(container.querySelector(".gpb")).toHaveAttribute("data-on");
      // Messages from anywhere else are ignored.
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event: "onReady" }), origin: "https://evil.example.com" }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("types each file by its extension", () => {
    expect(videoType("https://cdn.example.com/a.webm")).toBe("video/webm");
    expect(videoType("https://cdn.example.com/a.WEBM?x=1")).toBe("video/webm");
    expect(videoType("https://video.akamai.steamstatic.com/store_trailers/1/movie480.mp4")).toBe("video/mp4");
  });

  it("renders nothing without a trailer", () => {
    expect(mount(null).container.innerHTML).toBe("");
  });
});
