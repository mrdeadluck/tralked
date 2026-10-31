"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BackdropVideo } from "@/lib/queries/game-profile";

/*
 * Netflix-style background of the game page's banner (the open booklet): a muted gameplay loop
 * from the game's own trailer, faded into the hero art with a vignette, very low contrast so the
 * text on the booklet stays the thing you read. It is decoration only, and costs nothing unless
 * it can play:
 *
 * - not rendered without JS, with prefers-reduced-motion, or with Save-Data / prefers-reduced-data;
 * - not while the case intro runs (#gp-root[data-intro]): it starts once the page is revealed;
 * - the file / embed is only requested once the booklet is on screen, and it pauses off screen;
 * - absolutely positioned over the hero art (no layout shift); it fades in once frames play and
 *   simply never appears if the file fails;
 * - a small button pauses it (WCAG 2.2.2), remembered on this device.
 */

const ROOT_ID = "gp-root";
const PAUSED_KEY = "tralked:backdrop:paused";
const QUIET = "(prefers-reduced-motion: reduce), (prefers-reduced-data: reduce)";

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
@media (max-width: 1000px) { .gpb { -webkit-mask: linear-gradient(180deg, #000 0%, transparent 55%); mask: linear-gradient(180deg, #000 0%, transparent 55%); } }
@media (prefers-reduced-motion: reduce) { .gpb { display: none; } }
`;

const subscribeNothing = () => () => undefined;

function subscribeQuiet(onChange: () => void) {
  const mq = window.matchMedia(QUIET);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

/** Motion and data are fine to spend on decoration. */
function readAllowed(): boolean {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return !saveData && !window.matchMedia(QUIET).matches;
}

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

const youtubeSrc = (id: string, autoplay: boolean) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&disablekb=1&rel=0&iv_load_policy=3&enablejsapi=1`;

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
  /** Requested once, the first time it becomes active (nothing is fetched before). */
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(readPaused);
  /** The embed starts on its own only when it is not paused here (later changes go by command). */
  const [autoplay] = useState(() => !readPaused());

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

  const run = active && !paused;
  useEffect(() => {
    if (!loaded) return;
    if (video.kind === "file") {
      const v = player.current;
      if (!v) return;
      if (run) void v.play().catch(() => undefined);
      else v.pause();
    } else {
      // IFrame Player API commands (enablejsapi=1); the embed autoplays muted on its own.
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: run ? "playVideo" : "pauseVideo", args: [] }),
        "https://www.youtube-nocookie.com",
      );
    }
  }, [run, loaded, video.kind]);

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
        {loaded && video.kind === "file" ? (
          <video
            ref={player}
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onError={() => setFailed(true)}
          >
            {video.sources.map((src, i) => (
              <source
                key={src}
                src={src}
                type="video/mp4"
                // The last source failing means none could play.
                onError={i === video.sources.length - 1 ? () => setFailed(true) : undefined}
              />
            ))}
          </video>
        ) : null}
        {loaded && video.kind === "youtube" ? (
          <iframe
            ref={frame}
            src={youtubeSrc(video.youtubeId, autoplay)}
            title={`Trecho de gameplay de ${gameName} (fundo decorativo)`}
            tabIndex={-1}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setPlaying(true)}
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
