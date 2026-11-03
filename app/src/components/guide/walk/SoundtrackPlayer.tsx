"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";

/*
 * Mini player of the game's official soundtrack (a YouTube video or playlist the robot found from
 * the publisher, label or composer; Tralked never hosts audio). Nothing loads with the page: the
 * YouTube IFrame API (youtube-nocookie) and the player are created on the reader's first click or
 * key on the page, at volume 8. On a phone it never starts by itself: the ▶ button starts it.
 * While the music plays, YouTube's player is on screen (at least 200 × 200 px, as YouTube's terms
 * ask: the audio is never taken apart from it); pausing folds it into the bar, closing removes it.
 * Closing and the volume are remembered in this browser.
 */

type Soundtrack = NonNullable<Walkthrough["soundtrack"]>;

const STORAGE_KEY = "tralked:trilha";
const START_VOLUME = 8;

type Saved = { closed: boolean; volume: number };

/*
 * The saved choice lives in localStorage (read through useSyncExternalStore); the module copy keeps
 * the player working this session when storage is unavailable (private mode, blocked cookies).
 */
let memory = "";
const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function parse(raw: string): Saved {
  try {
    const saved = JSON.parse(raw || "{}") as Partial<Saved> | null;
    const volume = typeof saved?.volume === "number" && saved.volume >= 0 && saved.volume <= 100 ? saved.volume : START_VOLUME;
    return { closed: saved?.closed === true, volume };
  } catch {
    return { closed: false, volume: START_VOLUME };
  }
}

function save(saved: Saved) {
  memory = JSON.stringify(saved);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // Private mode or storage full: the choice holds for this visit only.
  }
  listeners.forEach((listener) => listener());
}

/** The parts of the YouTube IFrame API this player uses. */
type YTPlayer = {
  setVolume(volume: number): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      host: string;
      videoId?: string;
      width: number;
      height: number;
      playerVars: Record<string, string | number>;
      events: { onReady: (e: { target: YTPlayer }) => void; onStateChange: (e: { data: number }) => void };
    },
  ) => YTPlayer;
};
type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

/** YouTube player states. */
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
let apiReady: Promise<YTNamespace> | null = null;

/** Loads the IFrame API once per page. */
function loadYouTube(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  apiReady ??= new Promise((resolve) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiReady;
}

/** A phone or tablet (touch first): the music waits for the ▶ button. */
const touchFirst = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

/** The YouTube player while music plays: visible, 16:9, never under 200 px (YouTube's terms). */
const VIDEO_W = 356;
const VIDEO_H = 200;

type Phase = "idle" | "loading" | "playing" | "paused";

export function SoundtrackPlayer({ soundtrack }: { soundtrack: Soundtrack }) {
  // Null on the server: the player shows up once the saved choice is known in the browser.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const saved = useMemo(() => (raw === null ? null : parse(raw)), [raw]);
  const closed = saved === null || saved.closed;
  const volume = saved?.volume ?? START_VOLUME;
  const [phase, setPhase] = useState<Phase>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /** The player once ready (controls go through it only then). */
  const player = useRef<YTPlayer | null>(null);
  /** The player as created, to destroy it even before it is ready. */
  const instance = useRef<YTPlayer | null>(null);
  const creating = useRef(false);
  /** Bumped by every start and close: callbacks of an older run (closed meanwhile) do nothing. */
  const run = useRef(0);

  const start = useCallback(() => {
    if (creating.current || !frameRef.current) return;
    creating.current = true;
    const mine = ++run.current;
    const frame = frameRef.current;
    setPhase("loading");
    loadYouTube().then((YT) => {
      if (mine !== run.current) return; // closed while the API loaded
      // The API replaces this element with its iframe: keep it outside React's tree.
      const el = document.createElement("div");
      frame.appendChild(el);
      const { youtubeId, playlistId } = soundtrack;
      instance.current = new YT.Player(el, {
        host: "https://www.youtube-nocookie.com",
        videoId: youtubeId,
        width: VIDEO_W,
        height: VIDEO_H,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          loop: 1,
          ...(playlistId ? { listType: "playlist", list: playlistId } : youtubeId ? { playlist: youtubeId } : {}),
        },
        events: {
          onReady: (e) => {
            if (mine !== run.current) return e.target.destroy();
            player.current = e.target;
            e.target.setVolume(parse(readRaw()).volume);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (mine !== run.current) return;
            if (e.data === PLAYING) setPhase("playing");
            else if (e.data === PAUSED || e.data === ENDED) setPhase("paused");
          },
        },
      });
    });
  }, [soundtrack]);

  // On a computer, the first click or key anywhere on the page starts the music (the player's own
  // buttons do their own thing: closing it must not start it).
  useEffect(() => {
    if (closed || touchFirst()) return;
    const off = () => {
      document.removeEventListener("click", first);
      document.removeEventListener("keydown", first);
    };
    function first(e: Event) {
      if (rootRef.current?.contains(e.target as Node)) return;
      off();
      start();
    }
    document.addEventListener("click", first);
    document.addEventListener("keydown", first);
    return off;
  }, [closed, start]);

  useEffect(
    () => () => {
      run.current++;
      instance.current?.destroy();
    },
    [],
  );

  if (closed) return null;

  const playing = phase === "playing";
  const toggle = () => {
    if (!player.current) return start();
    if (playing) return player.current.pauseVideo();
    // The video shows again before it plays.
    setPhase("loading");
    player.current.playVideo();
  };
  const changeVolume = (next: number) => {
    player.current?.setVolume(next);
    save({ closed: false, volume: next });
  };
  const close = () => {
    run.current++;
    instance.current?.destroy();
    instance.current = null;
    player.current = null;
    creating.current = false;
    setPhase("idle");
    save({ closed: true, volume });
  };

  return (
    <div ref={rootRef} className={playing ? "wk-ost" : "wk-ost paused"} role="region" aria-label="Trilha sonora do jogo">
      {/* While the music plays (or starts), YouTube's own player is on screen; paused, only the bar. */}
      <div
        ref={frameRef}
        className="wk-ost-video tk-cut-sm"
        role="group"
        aria-label="Vídeo da trilha no YouTube"
        hidden={phase !== "loading" && phase !== "playing"}
        style={{ width: VIDEO_W, height: VIDEO_H }}
      />
      <button type="button" className="pp" onClick={toggle} aria-label={playing ? "Pausar a trilha" : "Tocar a trilha"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="eq" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="t">
        <b>Trilha · {soundtrack.title}</b>
        <span>{soundtrack.channel} · volume baixo</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(e) => changeVolume(Number(e.target.value))}
        aria-label="Volume da trilha"
      />
      <button type="button" className="x" onClick={close} aria-label="Fechar a trilha">
        ✕
      </button>
    </div>
  );
}
