"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { useSizedSrc } from "@/components/art/use-sized-src";
import type { DiscLabelArt } from "@/lib/queries/game-profile";
import { Wordmark } from "@/components/brand/Logo";
import { useSound } from "@/components/fx/useSound";
import { setCaseIntroAction } from "@/app/conta/actions";
import { markOpened } from "@/app/jogos/[slug]/actions";
import { markIntroPlayedThisSession, readIntroOff, readIntroPlayedThisSession, writeIntroOff } from "./case-intro-pref";
import { registerCaseReplay } from "./case-replay";
import { Disc } from "./Disc";
import { openedKey } from "./opened-key";
import { titleFitStyle } from "./title-fit";

/*
 * First visit to a game: the sealed case, in one motion. One click on "Abrir" (or on the case)
 * peels the seal, hinges the front cover open (the booklet is printed on its inner face), lifts and
 * spins the disc, flies the disc to its slot in the page hero, and fades the stage away (about
 * 3 s). Before opening, "Ver contracapa" turns the case around and dragging rotates it.
 *
 * It is only a layer over a page that is complete without it: nothing is in the server HTML. The
 * stage is mounted (portalled into <body>) only after hydration, when this visitor has not opened
 * the game yet (account: GameOpen; logged out: localStorage) and motion is allowed, so returning
 * visitors never paint its canvases or fetch its cover. "Pular" and Esc finish at once. The stage
 * is a native <dialog> opened with showModal(): the browser makes the rest of the document inert
 * without touching its elements, and Tab cycles inside the dialog. Sound only plays after the
 * visitor's own click (never on the 6 s auto-open), and the AudioContext is closed on unmount.
 *
 * The disc's flight is a FLIP on a fixed clone placed at the target box and animated with
 * transforms only, so nothing on the page moves (no layout shift).
 *
 * The page root (#gp-root) carries `data-intro`: "pending" (set before paint by IntroVeil),
 * "stage" while the case is up, "flight" while the disc flies. Page CSS veils sections and hides
 * the hero disc while it is set. Animation classes are driven imperatively on purpose: React never
 * renders those class names.
 */

const ROOT_ID = "gp-root";
const HOLD_ID = "gp-disc-hold";
const TITLE_ID = "gp-title";
const AUTO_OPEN_MS = 6000;
/** The one motion, step by step (ms from the click). */
const OPEN_AT = 380;
const SPIN_AT = 1300;
const FLY_AT = 2200;
const FLY_MS = 750;

const CSS = `
.gpc { --cw: clamp(240px, 21vw, 330px); --ch: calc(var(--cw) * 1.377); --d: 16px; --band: calc(var(--cw) * .1);
  position: fixed; inset: 0; z-index: 60; display: none; margin: 0; padding: 0; border: 0; width: 100%; height: 100%; max-width: none; max-height: none; overflow: hidden; color: var(--text);
  background: radial-gradient(60% 65% at 50% 45%, oklch(0.27 0.03 245), var(--bg) 75%); transition: opacity .6s ease; }
.gpc::backdrop { background: transparent; }
.gpc.gpc-on { display: block; }
.gpc.gpc-fade { opacity: 0; pointer-events: none; }
.gpc::after { content: ""; position: absolute; left: 30%; right: 30%; bottom: 82px; height: 36px; background: radial-gradient(closest-side, rgba(0,0,0,.7), transparent); pointer-events: none; }
.gpc-lbl { font-stretch: 75%; font-weight: 700; font-size: 12.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.gpc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 18px; border: 0; font: inherit; font-stretch: 80%; font-weight: 800; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; transition: filter .15s, background .15s; }
.gpc-btn:active { translate: 0 1px; }
.gpc-btn-p { background: var(--acc); color: var(--acc-ink); }
.gpc-btn-p:hover { filter: brightness(1.08); }
.gpc-btn-s { background: var(--hover-2); color: var(--text); }
.gpc-btn-s:hover { background: var(--border-2); }
.gpc-btn-sm { min-height: 36px; padding: 0 14px; font-size: 12.5px; }

.gpc-top { position: absolute; top: 14px; left: 14px; right: 14px; z-index: 6; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gpc-top > svg { height: 17px; width: auto; color: var(--text); }
.gpc-top-r { display: flex; gap: 6px; }
.gpc-mute { width: 36px; padding: 0; }
.gpc-mute svg { width: 16px; height: 16px; }
.gpc-mute[aria-pressed="true"] .gpc-wave { opacity: .15; }
.gpc-head { position: absolute; left: 16px; right: 16px; top: 11vh; z-index: 6; display: grid; justify-items: center; gap: 4px; text-align: center; transition: opacity .3s; }
.gpc-head b { font-weight: 900; font-stretch: 118%; font-size: min(clamp(22px, 3vw, 32px), calc((100vw - 32px) / var(--longest, 1))); line-height: 1.05; letter-spacing: -0.02em; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpc-ui { position: absolute; left: 0; right: 0; bottom: 24px; z-index: 6; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; transition: opacity .3s; }
.gpc-ui.gpc-gone, .gpc.gpc-run .gpc-head { opacity: 0; pointer-events: none; }
.gpc-pref { position: absolute; left: 18px; bottom: 18px; z-index: 6; display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 12.5px; color: var(--muted); cursor: pointer; }
.gpc-pref:hover { color: var(--text-2); }
.gpc-pref input { flex: none; width: 15px; height: 15px; margin: 0; accent-color: var(--acc); cursor: pointer; }

.gpc-scene { position: absolute; inset: 0; display: grid; place-items: center; perspective: 1600px; animation: gpc-in .7s cubic-bezier(.2,.9,.25,1) backwards; }
@keyframes gpc-in { from { opacity: 0; transform: translateY(-4vh); } }
.gpc-case { --turn: 0deg; position: relative; width: var(--cw); height: var(--ch); margin-bottom: 70px; transform-style: preserve-3d; touch-action: none; cursor: grab;
  transform: rotateX(9deg) rotateY(calc(-24deg + var(--turn))); transition: transform .9s cubic-bezier(.6,.05,.2,1); }
.gpc-case.gpc-drag { transition: none; cursor: grabbing; }
.gpc-case.gpc-opened { transform: rotateX(5deg) rotateY(0deg) translateX(calc(var(--cw) / 2)); transition-duration: .8s; cursor: default; }
.gpc-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; }
.gpc-tray { transform: translateZ(calc(var(--d) / -2 + 1px)); background: linear-gradient(160deg, oklch(0.24 0.008 250), oklch(0.17 0.006 250)); box-shadow: inset 0 0 0 2px oklch(0.3 0.008 250), inset 0 0 0 6px oklch(0.2 0.006 250); }
.gpc-tray::after { content: "TRALKED"; position: absolute; left: 0; right: 0; bottom: 12px; text-align: center; font-stretch: 75%; font-weight: 800; font-size: 9px; letter-spacing: .4em; color: oklch(0.42 0.01 250); }
.gpc-slot { position: absolute; left: 50%; top: 50%; width: calc(var(--cw) * .82); aspect-ratio: 1; translate: -50% -50%; transform: translateZ(0) scale(.95); transition: transform .8s cubic-bezier(.2,.8,.2,1); }
.gpc-case.gpc-opened .gpc-slot { transform: translateZ(50px) translateY(-4px) scale(1.03); }
.gpc-front { position: absolute; inset: 0; transform-style: preserve-3d; transform: translateZ(calc(var(--d) / 2)); transform-origin: left center; transition: transform 1s cubic-bezier(.62,.02,.22,1); }
.gpc-case.gpc-opened .gpc-front { transform: translateZ(calc(var(--d) / 2)) rotateY(-174deg); }
.gpc-out { background: var(--bg-deep); }
.gpc-out > img, .gpc-out > canvas { position: absolute; left: 0; top: var(--band); width: 100%; height: calc(100% - var(--band)); object-fit: cover; object-position: center 20%; }
.gpc-out > img.gpc-wblur { top: 0; height: 100%; filter: blur(24px) saturate(1.2) brightness(.5); transform: scale(1.6); }
.gpc-out > img.gpc-wide { top: calc(var(--band) + 8%); height: auto; aspect-ratio: 16 / 9; box-shadow: 0 12px 24px -8px rgba(0,0,0,.8); }
.gpc-band { position: absolute; top: 0; left: 0; right: 0; height: var(--band); z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 10px; background: linear-gradient(180deg, oklch(0.2 0.006 250), oklch(0.15 0.006 250)); border-bottom: 2px solid var(--acc); }
.gpc-band svg { height: calc(var(--cw) * .045); width: auto; color: var(--text); }
.gpc-band span { font-stretch: 75%; font-weight: 750; font-size: calc(var(--cw) * .032); letter-spacing: .1em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gpc-title { position: absolute; left: 0; right: 0; bottom: 9%; z-index: 1; padding: 0 8%; text-align: center; }
.gpc-title b { display: block; font-weight: 900; font-stretch: 125%; font-size: min(calc(var(--cw) * .115), calc(var(--cw) * .84 / var(--longest, 1))); line-height: .9; letter-spacing: -0.03em; text-transform: uppercase; color: var(--text); text-shadow: 0 4px 24px rgba(0,0,0,.7); overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpc-glass { position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(120deg, rgba(255,255,255,.16), transparent 35%, transparent 65%, rgba(255,255,255,.05)); }
/* The seal: a graphite strip with a lime outline across the opening edge, a white glint running down it. */
.gpc-seal { position: absolute; right: 0; top: 40%; z-index: 2; width: calc(var(--cw) * .08); min-width: 22px; height: calc(var(--cw) * .24); min-height: 74px; display: grid; place-items: center; overflow: hidden; background: linear-gradient(180deg, oklch(0.3 0.01 250), oklch(0.22 0.008 250)); box-shadow: inset 0 0 0 1px var(--acc), -2px 0 6px rgba(0,0,0,.5); transform-origin: right center; transition: transform .35s cubic-bezier(.6,0,.4,1), opacity .35s; }
.gpc-seal span { writing-mode: vertical-rl; font-stretch: 85%; font-weight: 850; font-size: 10px; letter-spacing: .16em; color: var(--acc); }
.gpc-seal::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 40%; background: linear-gradient(180deg, transparent, rgba(255,255,255,.45), transparent); transform: translateY(-100%); animation: gpc-glint 2.6s ease-in-out infinite; }
@keyframes gpc-glint { 60%, 100% { transform: translateY(260%); } }
.gpc-case.gpc-unsealed .gpc-seal { transform: scaleX(0); opacity: 0; }
/* Inner face of the front cover: the booklet. */
.gpc-in { transform: rotateY(180deg); background: linear-gradient(180deg, oklch(0.2 0.006 250), oklch(0.16 0.006 250)); }
.gpc-booklet { position: absolute; inset: calc(var(--cw) * .04); overflow: hidden; box-shadow: 4px 0 12px rgba(0,0,0,.5); }
.gpc-booklet > img, .gpc-booklet > canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.gpc-b-in { position: absolute; inset: 0; display: grid; align-content: space-between; padding: 8%; background: linear-gradient(180deg, rgba(10,12,16,.6), rgba(10,12,16,.3) 40%, rgba(10,12,16,.92)); }
.gpc-b-in .gpc-lbl { font-size: calc(var(--cw) * .034); color: var(--text-2); }
.gpc-b-in img { display: block; width: 80%; max-height: calc(var(--cw) * .3); object-fit: contain; object-position: left center; filter: drop-shadow(0 2px 6px rgba(0,0,0,.8)); }
.gpc-b-in .gpc-b-title { display: block; font-weight: 900; font-stretch: 125%; font-size: min(calc(var(--cw) * .07), calc(var(--cw) * .656 / var(--longest, 1))); line-height: .95; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpc-b-in p { margin-top: 6px; font-size: calc(var(--cw) * .036); color: var(--text-2); }
.gpc-rows { display: grid; gap: 3px; margin-top: 8px; }
.gpc-rows div { display: flex; justify-content: space-between; gap: 8px; padding-bottom: 2px; border-bottom: 1px solid rgba(255,255,255,.12); font-size: calc(var(--cw) * .036); }
.gpc-rows b { font-size: inherit; font-stretch: 100%; font-weight: 800; color: var(--acc); }
/* Back cover. */
.gpc-back { transform: rotateY(180deg) translateZ(calc(var(--d) / 2)); background: linear-gradient(180deg, oklch(0.2 0.012 250), oklch(0.15 0.008 250)); padding: calc(var(--cw) * .04); display: grid; gap: calc(var(--cw) * .027); align-content: start; }
.gpc-back-band { display: flex; justify-content: space-between; gap: 8px; padding-bottom: 5px; border-bottom: 2px solid var(--acc); font-stretch: 75%; font-weight: 800; font-size: calc(var(--cw) * .032); letter-spacing: .12em; text-transform: uppercase; color: var(--text-2); }
.gpc-back-band span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gpc-shots { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.gpc-shots img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--surface); }
.gpc-shots img:first-child { grid-column: 1 / -1; }
.gpc-back p { font-size: calc(var(--cw) * .032); line-height: 1.4; color: var(--text-2); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.gpc-facts { display: flex; flex-wrap: wrap; gap: 4px; }
.gpc-facts span { padding: 3px 5px; box-shadow: inset 0 0 0 1px var(--border-2); font-size: calc(var(--cw) * .029); font-weight: 700; color: var(--text-2); }
.gpc-barcode { justify-self: end; width: calc(var(--cw) * .28); height: calc(var(--cw) * .09); padding: 3px 4px; background: #fff; }
.gpc-barcode i { display: block; height: 100%; background: repeating-linear-gradient(90deg, #111 0 1px, transparent 1px 3px, #111 3px 5px, transparent 5px 6px, #111 6px 7px, transparent 7px 10px); }
.gpc-spine { width: var(--d); transform-origin: left center; transform: rotateY(-90deg) translateX(calc(var(--d) / -2)); background: linear-gradient(90deg, oklch(0.15 0.006 250), oklch(0.22 0.008 250)); display: grid; place-items: center; backface-visibility: visible; }
.gpc-spine span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 900; font-stretch: 112%; font-size: 8.5px; letter-spacing: .08em; color: var(--acc); white-space: nowrap; }
.gpc-edge { width: var(--d); left: auto; right: 0; transform-origin: right center; transform: rotateY(90deg) translateX(calc(var(--d) / 2)); background: repeating-linear-gradient(0deg, oklch(0.28 0.008 250) 0 2px, oklch(0.21 0.006 250) 2px 4px); }

.gpc-fly { position: fixed; z-index: 70; margin: 0; pointer-events: none; transform-origin: 0 0; will-change: transform; }

@media (max-width: 700px) {
  .gpc { --cw: 200px; }
  .gpc-case.gpc-opened { transform: rotateX(5deg) rotateY(0deg) translateX(calc(var(--cw) / 2)) scale(.88); }
  .gpc-ui { bottom: 62px; }
  .gpc-pref { left: 0; right: 0; bottom: 16px; justify-content: center; }
}
@media (max-height: 640px) { .gpc-head { top: 64px; } .gpc-case { margin-bottom: 40px; } }
`;

type BackCover = {
  /** Up to three screenshots (real files only). */
  shots: string[];
  summary: string | null;
  /** Short facts, already formatted ("63 conquistas", "16–36 h", "Nota 87"). */
  facts: string[];
  studio: string | null;
  year: number | null;
};

type CaseIntroProps = {
  gameId: string;
  slug: string;
  name: string;
  hues: Hues;
  seed: number;
  /** Real cover for the case front (generated art otherwise). */
  coverUrl: string | null;
  /** Wide art for a case without a portrait cover (hero, else a screenshot): shown whole. */
  wideArt?: string | null;
  /** Real art for the booklet inside the case (a screenshot, else the hero or cover). */
  bookletArt: string | null;
  /** The game's official logo, printed on the booklet (its name otherwise). */
  logoUrl?: string | null;
  /** The booklet's rows ("Conquistas 63", "Para os 100% 50 h", "Perdíveis 0"), real data only. */
  bookletRows?: { label: string; value: string }[];
  /** The back cover; null leaves it plain (the flip button still turns the case). */
  back?: BackCover | null;
  /** The disc's label: never the cover nor the hero (see `DiscLabelArt`). */
  disc: DiscLabelArt;
  platformLabel: string;
  discLabel: string;
  plat: boolean;
  bookletNote: string;
  /**
   * Logged in: whether the account already opened the game, and whether it turned the intro off
   * ("Não mostrar a abertura nos próximos jogos"). Null: logged out (localStorage only).
   */
  account: { opened: boolean; introOff: boolean } | null;
};

const root = () => document.getElementById(ROOT_ID);
const lockScroll = (on: boolean) => {
  document.body.style.overflow = on ? "hidden" : "";
};
/** Shows the veiled page at once (skip, returning visitor): page CSS drops the transitions meanwhile. */
const revealNow = () => {
  const r = root();
  if (!r) return;
  r.setAttribute("data-reveal", "instant");
  r.removeAttribute("data-intro");
  requestAnimationFrame(() => requestAnimationFrame(() => r.removeAttribute("data-reveal")));
};

type Noise = { dur: number; from: number; to: number; gain: number; type: BiquadFilterType };

/** A screenshot at the back cover's size (CDN thumbnail when there is one). */
function BackShot({ url }: { url: string }) {
  const sized = useSizedSrc(url, 320, "wide");
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={sized?.src} src={sized?.src} alt="" decoding="async" draggable={false} onError={sized?.onError} />;
}

export function CaseIntro(props: CaseIntroProps) {
  const { gameId, slug, name, hues, seed, coverUrl, wideArt = null, bookletArt, logoUrl = null, bookletRows = [], back = null } = props;
  const { disc, platformLabel, discLabel, plat, bookletNote, account } = props;
  const { muted, toggleMuted } = useSound();
  const mutedRef = useRef(muted);
  const audio = useRef<AudioContext | null>(null);

  const stage = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const ui = useRef<HTMLDivElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  const run = useRef({ id: 0, running: false, timers: [] as number[], auto: 0, flies: [] as HTMLElement[] });
  const openSequenceRef = useRef<(withSound: boolean) => Promise<void>>(async () => undefined);
  /** Sound is allowed only for a sequence the visitor started with a click. */
  const soundOn = useRef(false);
  /** How many `close` events of our own close() calls are still to come (not the visitor's). */
  const ownCloses = useRef(0);
  const drag = useRef<{ x: number; base: number; moved: number } | null>(null);
  /** Null: stage not mounted. Each request to show it (first visit, replay) gets a new `n`. */
  const [staged, setStaged] = useState<{ auto: boolean; n: number } | null>(null);
  /** The case shows its back cover. */
  const [turned, setTurned] = useState(false);
  const cover = useSizedSrc(coverUrl, 330, "fit");
  const wide = useSizedSrc(wideArt, 330, "wide");
  const logo = useSizedSrc(logoUrl, 330, "fit");
  /** "Não mostrar a abertura nos próximos jogos" (checked on a replay when it is already off). */
  const [introOff, setIntroOff] = useState(false);

  const setDialog = useCallback((mode: "modal" | "modeless" | null) => {
    const dialog = stage.current;
    if (!dialog) return;
    if (dialog.open) {
      // Its `close` event (dispatched now or queued) is ours, not the visitor's: onClose skips it.
      ownCloses.current++;
      dialog.close();
    }
    if (mode === "modal") dialog.showModal();
    else if (mode === "modeless") dialog.show();
  }, []);

  const toggleIntroOff = (off: boolean) => {
    setIntroOff(off);
    writeIntroOff(off);
    if (!account) return;
    // The account could not save it (session expired, network): undo it here too, so the box shows
    // what will really happen on the next game.
    const undo = () => {
      setIntroOff(!off);
      writeIntroOff(!off);
    };
    void setCaseIntroAction({ off })
      .then((result) => {
        if (!result.ok) undo();
      })
      .catch(undo);
  };

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // ---------- Sound (Web Audio, only after a click; respects the site-wide mute) ----------
  const ctx = useCallback(() => {
    if (!soundOn.current) return null;
    try {
      if (!audio.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        audio.current = new Ctor();
      }
      if (audio.current.state === "suspended") void audio.current.resume();
      return audio.current;
    } catch {
      return null;
    }
  }, []);

  const noise = useCallback(
    ({ dur, from, to, gain, type }: Noise) => {
      const a = mutedRef.current ? null : ctx();
      if (!a) return;
      try {
        const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const s = a.createBufferSource();
        s.buffer = buf;
        const f = a.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(from, a.currentTime);
        f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
        f.Q.value = 1.2;
        const g = a.createGain();
        g.gain.setValueAtTime(gain, a.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
        s.connect(f).connect(g).connect(a.destination);
        s.start();
      } catch {
        // sem áudio
      }
    },
    [ctx],
  );

  const tone = useCallback(
    (f1: number, f2: number, dur: number, gain = 0.08, type: OscillatorType = "sine") => {
      const a = mutedRef.current ? null : ctx();
      if (!a) return;
      try {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, a.currentTime);
        o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + dur);
        g.gain.setValueAtTime(0.0001, a.currentTime);
        g.gain.exponentialRampToValueAtTime(gain, a.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
        o.connect(g).connect(a.destination);
        o.start();
        o.stop(a.currentTime + dur + 0.05);
      } catch {
        // sem áudio
      }
    },
    [ctx],
  );

  // ---------- Opened state ----------
  const remember = useCallback(() => {
    try {
      localStorage.setItem(openedKey(slug), "1");
    } catch {
      // sem armazenamento local: a conta (se houver) guarda
    }
    if (account && !account.opened) void markOpened(gameId).catch(() => undefined);
  }, [account, gameId, slug]);

  const clearRun = useCallback(() => {
    const r = run.current;
    r.id++;
    r.running = false;
    r.timers.forEach((t) => window.clearTimeout(t));
    r.timers = [];
    window.clearTimeout(r.auto);
    r.flies.forEach((f) => f.remove());
    r.flies = [];
  }, []);

  const resetStage = useCallback(() => {
    const introDisc = slot.current?.querySelector<HTMLElement>(".gpd");
    ui.current?.classList.remove("gpc-gone");
    stage.current?.classList.remove("gpc-fade", "gpc-run");
    box.current?.classList.remove("gpc-unsealed", "gpc-opened", "gpc-drag");
    box.current?.style.setProperty("--turn", "0deg");
    introDisc?.classList.remove("gpd-spinning");
    if (introDisc) introDisc.style.visibility = "";
    drag.current = null;
  }, []);

  const hideStage = useCallback(() => {
    stage.current?.classList.remove("gpc-on", "gpc-fade");
    setDialog(null);
    lockScroll(false);
  }, [setDialog]);

  /** Skip / Esc / reduced motion: the page as it is, at once. */
  const finishInstant = useCallback(() => {
    const wasOpen = stage.current?.classList.contains("gpc-on") ?? false;
    clearRun();
    hideStage();
    resetStage();
    setTurned(false);
    revealNow();
    remember();
    if (wasOpen) document.getElementById(TITLE_ID)?.focus({ preventScroll: true });
  }, [clearRun, hideStage, remember, resetStage]);

  const showStage = useCallback(
    (autoOpen: boolean) => {
      clearRun();
      resetStage();
      window.scrollTo(0, 0);
      root()?.setAttribute("data-intro", "stage");
      stage.current?.classList.add("gpc-on");
      setDialog("modal");
      lockScroll(true);
      openBtn.current?.focus({ preventScroll: true });
      // The auto-open is not a gesture of the visitor: it plays silently.
      if (autoOpen) run.current.auto = window.setTimeout(() => void openSequenceRef.current(false), AUTO_OPEN_MS);
    },
    [clearRun, resetStage, setDialog],
  );

  /**
   * FLIP: a clone of the case's disc, fixed at the hero slot's box, starts transformed onto the
   * disc in the case and animates to no transform. Only `transform` moves: nothing shifts.
   */
  const flyDisc = (src: HTMLElement, target: DOMRect) => {
    const from = src.getBoundingClientRect();
    const clone = src.cloneNode(true) as HTMLElement;
    const canvases = src.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach((c, i) => c.getContext("2d")?.drawImage(canvases[i], 0, 0));
    clone.classList.add("gpc-fly", "gpd-spinning");
    Object.assign(clone.style, {
      left: `${target.left}px`,
      top: `${target.top}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
      visibility: "",
    });
    clone.setAttribute("aria-hidden", "true");
    const s = target.width > 0 ? from.width / target.width : 1;
    const start = `translate(${from.left - target.left}px, ${from.top - target.top}px) scale(${s})`;
    clone.style.transform = start;
    document.body.append(clone);
    run.current.flies.push(clone);
    clone.animate?.([{ transform: start }, { transform: "none" }], {
      duration: FLY_MS,
      easing: "cubic-bezier(.6,0,.25,1)",
      fill: "forwards",
    });
  };

  const openSequence = async (withSound: boolean) => {
    const r = run.current;
    if (r.running) return;
    r.running = true;
    soundOn.current = withSound;
    window.clearTimeout(r.auto);
    const id = r.id;
    const at = (ms: number) =>
      new Promise<boolean>((resolve) => {
        r.timers.push(window.setTimeout(() => resolve(r.id === id), ms));
      });

    // 0: the seal peels, the case turns to face the visitor.
    stage.current?.classList.add("gpc-run");
    ui.current?.classList.add("gpc-gone");
    setTurned(false);
    box.current?.classList.remove("gpc-drag");
    box.current?.style.setProperty("--turn", "0deg");
    box.current?.classList.add("gpc-unsealed");
    noise({ dur: 0.4, from: 5000, to: 1800, gain: 0.16, type: "highpass" }); // lacre rasgando
    // The front cover hinges open: the booklet on its inner face, the disc lifting.
    if (!(await at(OPEN_AT))) return;
    box.current?.classList.add("gpc-opened");
    noise({ dur: 0.07, from: 2600, to: 900, gain: 0.45, type: "bandpass" }); // clack da capa
    tone(140, 60, 0.12, 0.16, "triangle");
    // The disc spins.
    if (!(await at(SPIN_AT - OPEN_AT))) return;
    const introDisc = slot.current?.querySelector<HTMLElement>(".gpd");
    introDisc?.classList.add("gpd-spinning");
    tone(180, 900, 0.9, 0.05, "sine"); // disco girando
    // The disc flies to its slot in the hero; the stage fades over the page.
    if (!(await at(FLY_AT - SPIN_AT))) return;
    window.scrollTo(0, 0);
    const target = document.getElementById(HOLD_ID)?.getBoundingClientRect();
    if (introDisc && target && target.width > 0) {
      flyDisc(introDisc, target);
      introDisc.style.visibility = "hidden";
    }
    tone(260, 520, 0.5, 0.05, "sine");
    stage.current?.classList.add("gpc-fade");
    root()?.setAttribute("data-intro", "flight");
    // Out of the top layer for the flight: the clone flies above the fading stage, the page is live.
    setDialog("modeless");
    lockScroll(false);
    if (!(await at(FLY_MS + 20))) return;
    // Landed: the hero disc shows at once under the clone (no fade), then the clone goes.
    const page = root();
    page?.setAttribute("data-landed", "");
    page?.removeAttribute("data-intro");
    r.flies.forEach((f) => f.remove());
    r.flies = [];
    requestAnimationFrame(() => requestAnimationFrame(() => page?.removeAttribute("data-landed")));
    [523, 659, 784, 1047].forEach((f, i) => r.timers.push(window.setTimeout(() => tone(f, f, 0.5, 0.05, "triangle"), i * 90)));
    hideStage();
    resetStage();
    setTurned(false);
    r.running = false;
    remember();
    document.getElementById(TITLE_ID)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    openSequenceRef.current = openSequence;
  });

  // ---------- Back cover: the button turns the case, dragging rotates it ----------
  const turnTo = (back: boolean) => {
    window.clearTimeout(run.current.auto); // exploring the case: no auto-open under the visitor
    setTurned(back);
    box.current?.style.setProperty("--turn", back ? "180deg" : "0deg");
    soundOn.current = true;
    tone(300, 380, 0.1, 0.04, "sine");
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (run.current.running || e.button !== 0) return;
    window.clearTimeout(run.current.auto);
    drag.current = { x: e.clientX, base: turned ? 180 : 0, moved: 0 };
    box.current?.classList.add("gpc-drag");
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.abs(e.clientX - d.x));
    box.current?.style.setProperty("--turn", `${d.base + (e.clientX - d.x) * 0.8}deg`);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    box.current?.classList.remove("gpc-drag");
    // A click (no real drag) opens the case.
    if (d.moved < 4) {
      box.current?.style.setProperty("--turn", `${d.base}deg`);
      void openSequence(true);
      return;
    }
    const k = Math.round((d.base + (e.clientX - d.x) * 0.8) / 180);
    box.current?.style.setProperty("--turn", `${k * 180}deg`);
    setTurned(((k % 2) + 2) % 2 === 1);
  };

  // ---------- First visit decision (after hydration only) ----------
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let local = false;
    try {
      local = localStorage.getItem(openedKey(slug)) === "1";
    } catch {
      // sem armazenamento local
    }
    const opened = local || Boolean(account?.opened);
    // Logged in, the account's choice wins and this browser's copy follows it (re-enabled in /conta
    // on another device); logged out, the browser's copy is all there is.
    const off = account ? account.introOff : readIntroOff();
    if (account) writeIntroOff(account.introOff);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read once after hydration
    setIntroOff(off);
    if (opened || reduce || off) {
      revealNow();
      // Keep both records in sync (account opened elsewhere / opened here while logged out).
      if (!local || (account && !account.opened)) remember();
    } else if (readIntroPlayedThisSession()) {
      // The intro already played once in this visit: this new game opens at once. It is not marked
      // as opened, so a later visit still unseals it ("Ver a abertura de novo" plays it now).
      revealNow();
    } else {
      markIntroPlayedThisSession();
      // Mounting the stage is the decision itself: returning visitors never mount it. It depends on
      // browser-only state (localStorage, the motion preference), so it cannot be made while
      // rendering or hydrating; it runs once, after hydration.
      setStaged({ auto: true, n: 1 });
    }
    const unregister = reduce
      ? () => undefined
      : registerCaseReplay(() => {
          setTurned(false);
          setStaged((s) => ({ auto: false, n: (s?.n ?? 0) + 1 }));
        });
    const r = run.current;
    const stageEl = stage;
    const closes = ownCloses;
    return () => {
      unregister();
      r.id++;
      r.timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(r.auto);
      r.flies.forEach((f) => f.remove());
      stageEl.current?.classList.remove("gpc-on");
      if (stageEl.current?.open) {
        closes.current++;
        stageEl.current.close();
      }
      lockScroll(false);
      void audio.current?.close().catch(() => undefined);
      audio.current = null;
    };
    // Runs once per mount: the decision is made with the first props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the stage once it is mounted, and again on every replay.
  useEffect(() => {
    if (staged) showStage(staged.auto);
  }, [staged, showStage]);

  /** Esc on the modal dialog: finish at once (instead of the browser just closing it). */
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    finishInstant();
  };
  /** The browser may close the dialog by itself (Esc without a cancelable `cancel`): finish too. */
  const onClose = () => {
    const dialog = stage.current;
    // Our own close (finish, flight hand-off to modeless) leaves nothing to do.
    if (ownCloses.current > 0) {
      ownCloses.current--;
      return;
    }
    if (!dialog || dialog.open || !dialog.classList.contains("gpc-on")) return;
    finishInstant();
  };

  /** Keeps Tab inside the dialog while it is open. */
  const trapFocus = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab" || !stage.current) return;
    const items = [...stage.current.querySelectorAll<HTMLElement>("button, input")].filter(
      (b) => !b.closest(".gpc-gone"),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!staged) return null;
  const upper = name.toUpperCase();
  // Titles break only between words; --longest caps their size so the longest word fits.
  const fit = titleFitStyle(name);
  return createPortal(
    <dialog
      ref={stage}
      className="gpc"
      aria-label={`Abrindo ${name} pela primeira vez`}
      onKeyDown={trapFocus}
      onCancel={onCancel}
      onClose={onClose}
      data-testid="case-intro"
    >
      <style href="tralked-game-case" precedence="default">
        {CSS}
      </style>
      <div className="gpc-top">
        <Wordmark height={17} />
        <div className="gpc-top-r">
          <button
            type="button"
            className="gpc-btn gpc-btn-s gpc-btn-sm gpc-mute"
            aria-pressed={muted}
            aria-label={muted ? "Ligar som" : "Desligar som"}
            onClick={toggleMuted}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              <path className="gpc-wave" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            </svg>
          </button>
          <button type="button" className="gpc-btn gpc-btn-s gpc-btn-sm" onClick={finishInstant}>
            Pular
          </button>
        </div>
      </div>
      <div className="gpc-head">
        <span className="gpc-lbl">Primeira vez com este jogo</span>
        <b style={fit}>{name}</b>
      </div>

      <div className="gpc-scene">
        {/* The case is a picture (its printed labels are decoration): the buttons below do what a
            click or a drag on it does, and the dialog's name says what opens. */}
        <div
          ref={box}
          className="gpc-case"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="gpc-face gpc-tray" />
          <div ref={slot} className="gpc-slot">
            <Disc hues={hues} seed={seed} art={disc} name={name} label={discLabel} plat={plat} />
          </div>
          <div className="gpc-front">
            <div className="gpc-face gpc-out">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={cover?.src} src={cover?.src} alt="" decoding="async" draggable={false} onError={cover?.onError} />
              ) : wideArt ? (
                // No portrait cover: the game's wide art, whole over its own blur, above the title.
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gpc-wblur" src={wide?.src} alt="" decoding="async" draggable={false} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img key={wide?.src} className="gpc-wide" src={wide?.src} alt="" decoding="async" draggable={false} onError={wide?.onError} />
                </>
              ) : (
                <GameArt seed={seed + 7} hues={hues} figure light width={560} height={772} />
              )}
              <div className="gpc-band">
                <Wordmark height={14} />
                <span>{platformLabel}</span>
              </div>
              {coverUrl ? null : (
                <div className="gpc-title">
                  <b style={fit}>{name}</b>
                </div>
              )}
              <div className="gpc-glass" />
              <div className="gpc-seal">
                <span>LACRADO</span>
              </div>
            </div>
            <div className="gpc-face gpc-in">
              <div className="gpc-booklet">
                <GameArt seed={seed + 8} hues={hues} imageUrl={bookletArt} figure width={420} height={560} />
                <div className="gpc-b-in">
                  <span className="gpc-lbl">Encarte · manual</span>
                  <div>
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={logo.src} src={logo.src} alt="" decoding="async" draggable={false} onError={logo.onError} />
                    ) : (
                      <b className="gpc-b-title" style={fit}>{name}</b>
                    )}
                    <p>{bookletNote}</p>
                    {bookletRows.length > 0 ? (
                      <div className="gpc-rows">
                        {bookletRows.map((row) => (
                          <div key={row.label}>
                            <span>{row.label}</span>
                            <b>{row.value}</b>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="gpc-face gpc-back">
            <div className="gpc-back-band">
              <span>{upper}</span>
              <span>{[back?.studio, back?.year].filter(Boolean).join(" · ")}</span>
            </div>
            {back && back.shots.length > 0 ? (
              <div className="gpc-shots">
                {back.shots.slice(0, 3).map((url) => (
                  <BackShot key={url} url={url} />
                ))}
              </div>
            ) : null}
            {back?.summary ? <p>{back.summary}</p> : null}
            {back && back.facts.length > 0 ? (
              <div className="gpc-facts">
                {back.facts.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            ) : null}
            <div className="gpc-barcode">
              <i />
            </div>
          </div>
          <div className="gpc-face gpc-spine">
            <span>{upper} · TRALKED</span>
          </div>
          <div className="gpc-face gpc-edge" />
        </div>
      </div>

      <div ref={ui} className="gpc-ui">
        <button type="button" className="gpc-btn gpc-btn-s" onClick={() => turnTo(!turned)}>
          {turned ? "Ver a capa" : "Ver contracapa"}
        </button>
        <button ref={openBtn} type="button" className="gpc-btn gpc-btn-p tk-cut-b" onClick={() => void openSequence(true)}>
          Abrir
        </button>
      </div>
      <label className="gpc-pref">
        <input type="checkbox" checked={introOff} onChange={(e) => toggleIntroOff(e.target.checked)} />
        Não mostrar a abertura nos próximos jogos
      </label>
    </dialog>,
    document.body,
  );
}
