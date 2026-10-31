"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";
import type { GameVideo } from "@/lib/queries/game-profile";

/*
 * Horizontal rails of preview/tralked-jogo.html ("Trailers e vídeos", "Imagens oficiais"): snap
 * scrolling, prev/next buttons in the section head (shown once JS is up; without it the rail
 * still scrolls). Videos never autoplay: a poster tile that loads the player on click (a <video>
 * for files, a privacy-enhanced YouTube embed for YouTube ids).
 */

const CSS = `
.gpr-rail { display: grid; grid-auto-flow: column; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 10px; scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; overscroll-behavior-x: contain; }
.gpr-rail > * { scroll-snap-align: start; }
.gpr-rail:focus-visible { outline-offset: 4px; }
.gpr-videos { grid-auto-columns: minmax(300px, 30%); }
.gpr-shots { grid-auto-columns: minmax(260px, 24%); }
.gpr-tools { display: flex; gap: 6px; }
.gpr-btn { width: 36px; height: 36px; border: 1px solid var(--border-2); background: var(--surface-2); color: var(--text); border-radius: 2px; display: grid; place-items: center; cursor: pointer; }
.gpr-btn:hover { border-color: var(--text); }
.gpr-btn svg { width: 16px; height: 16px; }
.gpr-tile { position: relative; display: block; width: 100%; border: 0; padding: 0; border-radius: 3px; overflow: hidden; background: var(--surface); color: var(--text); text-align: left; }
.gpr-tile img, .gpr-tile canvas, .gpr-tile video, .gpr-tile iframe { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; border: 0; }
.gpr-v { aspect-ratio: 16 / 9; }
.gpr-s { aspect-ratio: 16 / 10; }
button.gpr-tile { cursor: pointer; }
.gpr-over { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 14px; background: linear-gradient(180deg, transparent 40%, rgba(6,6,8,.9)); }
.gpr-over b { font-weight: 800; font-size: 16px; line-height: 1.2; }
.gpr-over small { font-family: var(--font-jetbrains-mono), monospace; font-size: 11px; color: var(--muted); }
.gpr-play { position: absolute; left: 50%; top: 42%; translate: -50% -50%; width: 52px; height: 52px; border-radius: 50%; background: rgba(11,12,15,.6); border: 1px solid rgba(236,236,230,.3); display: grid; place-items: center; transition: transform .2s, background .2s, color .2s; }
.gpr-play svg { width: 18px; height: 18px; margin-left: 3px; }
button.gpr-tile:hover .gpr-play, button.gpr-tile:focus-visible .gpr-play { transform: scale(1.1); background: var(--acc); color: var(--bg); }
button.gpr-tile:hover { box-shadow: 0 0 0 1px var(--acc); }
@media (max-width: 600px) { .gpr-videos { grid-auto-columns: 82%; } .gpr-shots { grid-auto-columns: 70%; } }
`;

const subscribeNothing = () => () => undefined;

function Chevron({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={dir === 1 ? "m6 3 5 5-5 5" : "m10 3-5 5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Section with a heading, prev/next tools and a snapping horizontal rail. */
export function Rail({
  id,
  headingId,
  title,
  variant,
  label,
  children,
}: {
  id?: string;
  headingId: string;
  title: string;
  variant: "videos" | "shots";
  label: string;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const scroll = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: el.clientWidth * 0.8 * dir, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section id={id} className="gp-veil" aria-labelledby={headingId}>
      <style href="tralked-game-rails" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id={headingId}>{title}</h2>
        {hydrated ? (
          <div className="gpr-tools">
            <button type="button" className="gpr-btn" aria-label="Voltar" onClick={() => scroll(-1)}>
              <Chevron dir={-1} />
            </button>
            <button type="button" className="gpr-btn" aria-label="Avançar" onClick={() => scroll(1)}>
              <Chevron dir={1} />
            </button>
          </div>
        ) : null}
      </div>
      <div ref={rail} className={`gpr-rail gpr-${variant}`} role="list" aria-label={label} tabIndex={0}>
        {children}
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <span className="gpr-play" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

function VideoTile({ video, gameName, hues, seed }: { video: GameVideo; gameName: string; hues: Hues; seed: number }) {
  const [playing, setPlaying] = useState(false);
  const name = `${video.title} de ${gameName}`;

  if (playing) {
    return (
      <div className="gpr-tile gpr-v" role="listitem">
        {video.kind === "file" ? (
          <video src={video.url} poster={video.poster ?? undefined} controls autoPlay playsInline preload="metadata" aria-label={name} />
        ) : (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`}
            title={name}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    );
  }

  const poster = video.kind === "file" ? video.poster : `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;
  return (
    <div role="listitem">
      <button type="button" className="gpr-tile gpr-v" onClick={() => setPlaying(true)} aria-label={`Assistir: ${name}`}>
        <GameArt seed={seed} hues={hues} imageUrl={poster} figure width={640} height={360} />
        <span className="gpr-over">
          <b>{video.title}</b>
          <small>{video.source}</small>
        </span>
        <PlayIcon />
      </button>
    </div>
  );
}

export function MediaRail({
  videos,
  gameName,
  hues,
  seed,
}: {
  videos: GameVideo[];
  gameName: string;
  hues: Hues;
  seed: number;
}) {
  if (videos.length === 0) return null;
  return (
    <Rail id="videos" headingId="gp-h-vid" title="Trailers e vídeos" variant="videos" label={`Vídeos de ${gameName}`}>
      {videos.map((v, i) => (
        <VideoTile key={v.id} video={v} gameName={gameName} hues={hues} seed={seed + 40 + i} />
      ))}
    </Rail>
  );
}
