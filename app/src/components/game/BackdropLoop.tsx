"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BackdropVideo } from "@/lib/queries/game-profile";

/*
 * Netflix-style background of the game page's banner (the open booklet): a muted gameplay loop
 * from the game's own trailer, faded into the hero art with a vignette, very low contrast so the
 * text on the booklet stays the thing you read. It is decoration only, and costs little unless it
 * can play:
 *
 * - not rendered without JS, with prefers-reduced-motion / prefers-reduced-data, Save-Data or a
 *   slow connection (2g/3g), nor on screens narrower than 1000 px;
 * - a trailer file only loads its metadata until the booklet is on screen, and a YouTube embed is
 *   only created then; it starts once the case intro is over (#gp-root[data-intro]) and pauses
 *   off screen; it starts 10 s in, past the rating cards;
 * - absolutely positioned over the hero art (no layout shift); it fades in only once frames really
 *   play (the file's `playing`, YouTube's "playing" state), and never appears if it fails;
 * - a small button pauses it (WCAG 2.2.2), remembered on this device.
 */

const ROOT_ID = "gp-root";
const PAUSED_KEY = "tralked:backdrop:paused";
const QUIET = "(prefers-reduced-motion: reduce), (prefers-reduced-data: reduce), (max-width: 999px)";
const SLOW_CONNECTIONS = new Set(["slow-2g", "2g", "3g"]);
const START_AT_S = 10;
const YT_ORIGIN = "https://www.youtube-nocookie.com";
const YT_PLAYING = 1;

const CSS = `
.gpb { position: absolute; inset: 0; overflow: hidden; pointer-events: none; container-type: size; opacity: 0; transition: opacity 1.6s ease;
  -webkit-mask: linear-gradient(90deg, transparent 22%, #000 70%); mask: linear-gradient(90deg, transparent 22%, #000 70%); }
.gpb[data-on] { opacity: .3; }
.gpb video, .gpb iframe { position: absolute; left: 50%; top: 50%; translate: -50% -50%; border: 0; object-fit: cover;
  width: max(100cqw, 177.78cqh); height: max(100cqh, 56.25cqw); }
.gpb::after { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse 75% 70% at 70% 45%, transparent 35%, var(--paper) 100%), linear-gradient(180deg, rgba(11,12,15,.35), transparent 30%, transparent 70%, rgba(11,12,15,.5)); }
.gpb-pause { position: absolute; top: 12px; right: 12px; z-index: 3; width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border-2); border-radius: 2px; background: rgba(11,12,15,.6); color: var(--text-2); cursor: pointer; }
.gpb-pause:hover { border-color: var(--text); color: var(--text); }
.gpb-pause svg { width: 12px; height: 12px; }
@media (prefers-reduced-motion: reduce), (max-width: 999px) { .gpb, .gpb-pause { display: none; } }
`;

const subscribeNothing = () => () => undefined;

function subscribeQuiet(onChange: () => void) {
  const mq = window.matchMedia(QUIET);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

type Connection = { saveData?: boolean; effectiveType?: string };

/** Motion, data and screen room are fine to spend on decoration. */
function readAllowed(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData === true || SLOW_CONNECTIONS.has(connection?.effectiveType ?? "")) return false;
  return !window.matchMedia(QUIET).matches;
}

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The file's MIME type from its extension (Steam serves mp4; other hosts may serve webm). */
export function videoType(url: string): string {
  return /\.webm(?:[?#]|$)/i.test(url) ? "video/webm" : "video/mp4";
}

const youtubeSrc = (id: string, autoplay: boolean, origin: string) =>
  `${YT_ORIGIN}/embed/${id}?autoplay=${autoplay ? 1 : 0}&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&disablekb=1&rel=0&iv_load_policy=3&start=${START_AT_S}&enablejsapi=1&origin=${encodeURIComponent(origin)}`;

/** IFrame Player API command over postMessage (enablejsapi=1). */
function ytCommand(frame: HTMLIFrameElement | null, play: boolean) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: play ? "playVideo" : "pauseVideo", args: [] }), YT_ORIGIN);
}

export function BackdropLoop({ video, gameName }: { video: BackdropVideo; gameName: string }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const allowed = useSyncExternalStore(subscribeQuiet, readAllowed, () => false);
  if (!video || !hydrated || !allowed) return null;
  return <Loop video={video} gameName={gameName} />;
}

function Loop({ video, gameName }: { video: NonNullable<BackdropVideo>; gameName: string }) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  /** On screen and the case intro is over. */
  const [active, setActive] = useState(false);
  /** Became active once: the file loads for real / the embed is created. */
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(readPaused);
  /** The embed starts on its own only when it is not paused here (later changes go by command). */
  const [autoplay] = useState(() => !readPaused());
  const run = active && !paused;
  const runRef = useRef(run);
  /** The YouTube player answered: commands sent before that are lost, so they wait for it. */
  const ytReady = useRef(false);

  useEffect(() => {
    const el = box.current;
    const root = document.getElementById(ROOT_ID);
    if (!el) return;
    let visible = false;
    const update = () => {
      const on = visible && !root?.hasAttribute("data-intro");
      setActive(on);
      if (on) setLoaded(true);
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(el);
    const mo = new MutationObserver(update);
    if (root) mo.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    runRef.current = run;
    if (!loaded) return;
    if (video.kind === "file") {
      const v = player.current;
      if (!v) return;
      if (run) void v.play().catch(() => undefined);
      else v.pause();
    } else if (ytReady.current) {
      ytCommand(frame.current, run);
    }
  }, [run, loaded, video.kind]);

  // YouTube IFrame API over postMessage: the player only talks once it hears "listening", then
  // reports its state; the first answer means it is ready for the current command.
  useEffect(() => {
    if (video.kind !== "youtube" || !loaded) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown } | null = null;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : null;
      } catch {
        return;
      }
      if (!data?.event) return;
      if (!ytReady.current) {
        ytReady.current = true;
        ytCommand(frame.current, runRef.current);
      }
      const info = data.info as { playerState?: number } | number | undefined;
      const state = typeof info === "number" ? (data.event === "onStateChange" ? info : undefined) : info?.playerState;
      if (state === YT_PLAYING) setPlaying(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [video.kind, loaded]);

  const listen = () => {
    let tries = 0;
    const hello = () => {
      if (ytReady.current || tries++ > 40) return;
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN);
      window.setTimeout(hello, 250);
    };
    hello();
  };

  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    try {
      if (next) localStorage.setItem(PAUSED_KEY, "1");
      else localStorage.removeItem(PAUSED_KEY);
    } catch {
      // sem armazenamento local
    }
  };

  if (failed) return null;
  return (
    <>
      <style href="tralked-game-backdrop" precedence="default">
        {CSS}
      </style>
      <div ref={box} className="gpb" aria-hidden="true" data-on={playing ? "" : undefined} data-testid="backdrop-loop">
        {video.kind === "file" ? (
          <video
            ref={player}
            muted
            loop
            playsInline
            // Only the metadata until the booklet is on screen and the intro is over.
            preload={loaded ? "auto" : "metadata"}
            disablePictureInPicture
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onError={() => setFailed(true)}
          >
            {video.sources.map((src, i) => (
              <source
                key={src}
                src={`${src}#t=${START_AT_S}`}
                type={videoType(src)}
                // The last source failing means none could play.
                onError={i === video.sources.length - 1 ? () => setFailed(true) : undefined}
              />
            ))}
          </video>
        ) : loaded ? (
          <iframe
            ref={frame}
            src={youtubeSrc(video.youtubeId, autoplay, window.location.origin)}
            title={`Trecho de gameplay de ${gameName} (fundo decorativo)`}
            tabIndex={-1}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={listen}
          />
        ) : null}
      </div>
      {playing || (loaded && paused) ? (
        <button
          type="button"
          className="gpb-pause"
          aria-pressed={paused}
          aria-label={paused ? "Retomar o vídeo de fundo" : "Pausar o vídeo de fundo"}
          onClick={togglePaused}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {paused ? (
              <path d="M7 4v16l13-8z" />
            ) : (
              <>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </>
            )}
          </svg>
        </button>
      ) : null}
    </>
  );
}
