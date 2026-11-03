"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";

/*
 * Mini player of the game's official soundtrack (a YouTube video or playlist the robot found from
 * the publisher, label or composer; Tralked never hosts audio). Nothing loads with the page: the
 * YouTube IFrame API (youtube-nocookie) and the player are created on the reader's first click or
 * key on the page, at volume 8. On a phone it never starts by itself: the ▶ button starts it.
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
      playerVars: Record<string, string | number>;
      events: { onReady: (e: { target: YTPlayer }) => void; onStateChange: (e: { data: number }) => void };
    },
  ) => YTPlayer;
};
type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

const PLAYING = 1;
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

export function SoundtrackPlayer({ soundtrack }: { soundtrack: Soundtrack }) {
  // Null on the server: the player shows up once the saved choice is known in the browser.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const saved = useMemo(() => (raw === null ? null : parse(raw)), [raw]);
  const closed = saved === null || saved.closed;
  const volume = saved?.volume ?? START_VOLUME;
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const creating = useRef(false);

  const start = useCallback(() => {
    if (creating.current || !frameRef.current) return;
    creating.current = true;
    const frame = frameRef.current;
    loadYouTube().then((YT) => {
      // The API replaces this element with its iframe: keep it outside React's tree.
      const el = document.createElement("div");
      frame.appendChild(el);
      const { youtubeId, playlistId } = soundtrack;
      player.current = new YT.Player(el, {
        host: "https://www.youtube-nocookie.com",
        videoId: youtubeId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          controls: 0,
          loop: 1,
          ...(playlistId ? { listType: "playlist", list: playlistId } : youtubeId ? { playlist: youtubeId } : {}),
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(parse(readRaw()).volume);
            e.target.playVideo();
          },
          onStateChange: (e) => setPlaying(e.data === PLAYING),
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
      player.current?.destroy();
      player.current = null;
    },
    [],
  );

  if (closed) return null;

  const toggle = () => {
    if (!player.current) return start();
    if (playing) player.current.pauseVideo();
    else player.current.playVideo();
  };
  const changeVolume = (next: number) => {
    player.current?.setVolume(next);
    save({ closed: false, volume: next });
  };
  const close = () => {
    player.current?.destroy();
    player.current = null;
    creating.current = false;
    setPlaying(false);
    save({ closed: true, volume });
  };

  return (
    <div ref={rootRef} className={playing ? "wk-ost" : "wk-ost paused"} role="region" aria-label="Trilha sonora do jogo">
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
      <div className="frame" ref={frameRef} aria-hidden="true" />
    </div>
  );
}
