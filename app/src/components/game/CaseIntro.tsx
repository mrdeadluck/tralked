"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { useSound } from "@/components/fx/useSound";
import { markOpened } from "@/app/jogos/[slug]/actions";
import { registerCaseReplay } from "./case-replay";
import { Disc } from "./Disc";
import { openedKey } from "./opened-key";
import { titleFitStyle } from "./title-fit";

/*
 * First visit to a game: the sealed case of preview/tralked-jogo.html. Seal peel with an edge
 * glint, the front cover hinging open, the disc lifting and spinning, then the disc flies to its
 * slot on the page while the booklet grows into the page background and the page reveals.
 *
 * It is only a layer over a page that is complete without it: nothing is in the server HTML. The
 * stage is mounted (portalled into <body>) only after hydration, when this visitor has not opened
 * the game yet (account: GameOpen; logged out: localStorage) and motion is allowed, so returning
 * visitors never paint its canvases or fetch its cover. "Pular" and Esc finish at once. The stage
 * is a native <dialog> opened with showModal(): the browser makes the rest of the document inert
 * without touching its elements (setting `inert` on <header>/<main> while the layout may still be
 * hydrating caused hydration mismatches), and Tab cycles inside the dialog. Sound only plays
 * after the visitor's own click (never on the 6 s auto-open), and the AudioContext is closed on
 * unmount.
 *
 * The page root (#gp-root) carries `data-intro`: "pending" (set before paint by IntroVeil, so the
 * page does not flash before the case drops in), "stage" while the case is up, "flight" while the
 * disc flies. Page CSS veils sections and hides the hero disc while it is set. Visibility and
 * animation classes are driven imperatively on purpose: the timings are the preview's, step by
 * step, and React never renders those class names.
 */

const ROOT_ID = "gp-root";
const HOLD_ID = "gp-disc-hold";
const TITLE_ID = "gp-title";
const AUTO_OPEN_MS = 6000;

const CSS = `
.gpc { --cw: min(280px, 34vw); --band: calc(var(--cw) * .18); --ch: calc(var(--cw) * 1.38); --case: #191b21; --case-2: #0e0f13; --case-rim: #24262e; --case-in: #121318;  position: fixed; inset: 0; z-index: 60; display: none; place-items: center; perspective: 1700px;
  margin: 0; padding: 0; border: 0; width: 100%; height: 100%; max-width: none; max-height: none; overflow: hidden; color: inherit;
  background: radial-gradient(ellipse 70% 60% at 50% 42%, #1a1c23 0%, var(--bg) 55%, #050507 100%); transition: opacity .9s ease; }
.gpc::backdrop { background: transparent; }
.gpc.gpc-on { display: grid; }
.gpc::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 40% 12% at 50% 84%, rgba(0,0,0,.6), transparent 70%); }
.gpc.gpc-fade { opacity: 0; pointer-events: none; }
.gpc-ui { position: absolute; left: 0; right: 0; bottom: 6vh; display: flex; flex-direction: column; align-items: center; gap: 14px; z-index: 3; transition: opacity .4s; }
.gpc-ui.gpc-gone { opacity: 0; pointer-events: none; }
.gpc-ui p { font-family: var(--font-jetbrains-mono), monospace; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.gpc-open { height: 48px; padding: 0 22px; border: 0; border-radius: 2px; background: var(--acc); color: var(--bg); font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; animation: gpc-pulse 2s ease-in-out infinite; }
.gpc-open:hover { filter: brightness(1.08); }
@keyframes gpc-pulse { 50% { box-shadow: 0 0 0 10px rgba(198,244,50,0); } 0%, 100% { box-shadow: 0 0 0 0 rgba(198,244,50,.35); } }
.gpc-skip, .gpc-mute { position: absolute; top: 18px; z-index: 4; height: 36px; border: 1px solid var(--border-2); background: rgba(11,12,15,.6); border-radius: 2px; color: var(--text-2); cursor: pointer; }
.gpc-skip { right: 18px; padding: 0 14px; font-family: var(--font-jetbrains-mono), monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
.gpc-mute { left: 18px; width: 36px; display: grid; place-items: center; }
.gpc-mute svg { width: 16px; height: 16px; }
.gpc-mute[aria-pressed="true"] .gpc-wave { opacity: .15; }
.gpc-skip:hover, .gpc-mute:hover { border-color: var(--text); color: var(--text); }

.gpc-wrap { position: relative; transform-style: preserve-3d; transform: rotateX(14deg) rotateY(-24deg) rotateZ(1.5deg) translateY(-3vh); transition: transform 1.2s cubic-bezier(.55,.05,.2,1); animation: gpc-drop .9s cubic-bezier(.2,.9,.25,1.05) backwards; }
@keyframes gpc-drop { from { transform: rotateX(30deg) rotateY(-40deg) translateY(-30vh) scale(.8); opacity: 0; } }
.gpc-wrap.gpc-opening { transform: rotateX(8deg) rotateY(0deg) rotateZ(0) translateX(calc(var(--cw) / 2)) translateY(-3vh); }
.gpc-case { position: relative; width: var(--cw); height: var(--ch); transform-style: preserve-3d; }
.gpc-tray { position: absolute; inset: 0; border-radius: 3px 10px 10px 3px; background: linear-gradient(160deg, var(--case), var(--case-2) 70%); box-shadow: 0 50px 90px -20px rgba(0,0,0,.85), inset 0 0 0 2px var(--case-rim), inset 0 0 0 6px var(--case-in); }
.gpc-tray::before { content: ""; position: absolute; left: 50%; top: 50%; width: 22%; aspect-ratio: 1; translate: -50% -50%; border-radius: 50%; background: repeating-conic-gradient(#2a2d36 0 10deg, #1a1c22 10deg 20deg); box-shadow: 0 0 0 3px #0d0e12, 0 0 0 5px #2a2d36; }
.gpc-tray::after { content: "TRALKED"; position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; font-family: var(--font-jetbrains-mono), monospace; font-size: 9px; letter-spacing: .4em; color: #2e3139; }
.gpc-spine { position: absolute; left: 0; top: 0; width: 15px; height: 100%; transform-origin: left center; transform: rotateY(-90deg); background: linear-gradient(90deg, #0c0d10, #1b1d23 60%, #101114); display: grid; place-items: center; overflow: hidden; }
.gpc-spine span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 900; font-stretch: 125%; font-size: 8px; letter-spacing: .1em; color: var(--text-2); white-space: nowrap; }
.gpc-edge { position: absolute; right: 0; top: 0; width: 15px; height: 100%; transform-origin: right center; transform: rotateY(-90deg); background: linear-gradient(90deg, #0f1014, #1c1e24); }
.gpc-front { position: absolute; inset: 0; transform-origin: left center; transform-style: preserve-3d; transform: translateZ(15px); transition: transform 1.25s cubic-bezier(.62,.02,.22,1); }
.gpc-case.gpc-open-case .gpc-front { transform: translateZ(15px) rotateY(-176deg); }
.gpc-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 3px 10px 10px 3px; overflow: hidden; }
.gpc-out { background: #0d0e12; box-shadow: inset 0 0 0 2px rgba(255,255,255,.04); }
.gpc-out > img, .gpc-out > canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* A real cover fills the whole front below the band: the case grows to the cover's own proportion
   (--cover-r, set from the loaded image), so the band never hides the game's name and nothing is cropped or letterboxed. */
.gpc.gpc-has-cover { --ch: calc(var(--band) + var(--cw) * var(--cover-r, 1.5)); }
.gpc-out > img.gpc-cover { top: var(--band); height: calc(100% - var(--band)); object-fit: cover; }
.gpc-top { position: absolute; left: 0; right: 0; top: 0; height: var(--band); background: linear-gradient(180deg, var(--bg), #121318); display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 10px; border-bottom: 2px solid var(--acc); }
.gpc-top b { font-weight: 900; font-stretch: 125%; font-size: calc(var(--cw) * .06); letter-spacing: -0.02em; }
.gpc-top b i { font-style: normal; color: var(--acc); }
.gpc-top span { font-family: var(--font-jetbrains-mono), monospace; font-size: calc(var(--cw) * .032); letter-spacing: .14em; color: var(--text-2); border: 1px solid var(--border-2); padding: 2px 5px; white-space: nowrap; }
.gpc-title { position: absolute; left: 0; right: 0; bottom: 9%; text-align: center; padding: 0 8%; }
.gpc-title b { display: block; font-weight: 900; font-stretch: 125%; font-size: min(calc(var(--cw) * .115), calc(var(--cw) * .84 / var(--longest, 1))); line-height: .9; letter-spacing: -0.03em; text-transform: uppercase; color: #f3f1ea; text-shadow: 0 4px 24px rgba(0,0,0,.7); overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpc-title span { display: block; margin-top: 6px; font-family: var(--font-jetbrains-mono), monospace; font-size: calc(var(--cw) * .03); letter-spacing: .2em; text-transform: uppercase; color: #b9c3d8; }
.gpc-sleeve { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,0) 60%, rgba(255,255,255,.06) 75%, rgba(255,255,255,0) 90%); mix-blend-mode: screen; }
.gpc-in { transform: rotateY(180deg); background: linear-gradient(200deg, #17191f, var(--case-2)); box-shadow: inset 0 0 0 2px var(--case-rim), inset 0 0 0 6px var(--case-in); display: grid; place-items: center; }
.gpc-clip { position: absolute; width: 18px; height: 8px; background: #2a2d36; border-radius: 2px; }
.gpc-booklet { position: relative; width: 82%; height: 86%; border-radius: 2px; background: var(--paper-2); box-shadow: 0 2px 0 #0a0b0e, 0 10px 30px rgba(0,0,0,.5); overflow: hidden; }
.gpc-booklet > img, .gpc-booklet > canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .55; }
.gpc-b-in { position: absolute; inset: 0; padding: 14% 10%; display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(180deg, rgba(21,22,27,.2), rgba(21,22,27,.95) 70%); }
.gpc-b-in b { display: block; font-weight: 900; font-stretch: 125%; font-size: min(calc(var(--cw) * .07), calc(var(--cw) * .656 / var(--longest, 1))); line-height: .95; text-transform: uppercase; overflow-wrap: normal; word-break: normal; hyphens: manual; }
.gpc-b-in span { font-family: var(--font-jetbrains-mono), monospace; font-size: calc(var(--cw) * .03); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.gpc-seal { position: absolute; inset: -2px; transform: translateZ(17px); border-radius: 4px 11px 11px 4px; pointer-events: none; overflow: hidden;
  background: linear-gradient(125deg, rgba(255,255,255,.16), rgba(255,255,255,.02) 30%, rgba(255,255,255,.1) 48%, rgba(255,255,255,0) 60%, rgba(255,255,255,.08));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); clip-path: inset(0 0 0 0); transition: clip-path .75s cubic-bezier(.5,0,.3,1), opacity .3s .7s; }
.gpc-seal::before { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 35%, rgba(255,255,255,.35) 48%, transparent 60%); transform: translateX(-120%); animation: gpc-glint 3.2s ease-in-out 1s infinite; }
@keyframes gpc-glint { 40%, 100% { transform: translateX(120%); } }
.gpc-tab { position: absolute; top: 34%; right: -1px; width: 30px; height: 46px; background: var(--acc); border-radius: 3px 0 0 3px; display: grid; place-items: center; }
.gpc-tab span { writing-mode: vertical-rl; font-family: var(--font-jetbrains-mono), monospace; font-size: 8px; font-weight: 700; letter-spacing: .2em; color: var(--bg); }
.gpc-seal.gpc-peel { clip-path: inset(0 0 0 100%); opacity: 0; }
.gpc-seal-edge { position: absolute; top: -2px; bottom: -2px; width: 3px; left: 0; transform: translateZ(18px); background: linear-gradient(180deg, transparent, rgba(255,255,255,.8), transparent); opacity: 0; pointer-events: none; }
.gpc-seal-edge.gpc-run { animation: gpc-edge .75s cubic-bezier(.5,0,.3,1) forwards; }
@keyframes gpc-edge { 0% { opacity: 1; left: 0; } 90% { opacity: 1; } 100% { opacity: 0; left: 100%; } }
.gpc-slot { position: absolute; left: 50%; top: 50%; width: 88%; aspect-ratio: 1; translate: -50% -50%; transform: translateZ(4px); transform-style: preserve-3d; }
.gpc-slot.gpc-lift { animation: gpc-lift 1s cubic-bezier(.3,.9,.3,1) forwards; }
@keyframes gpc-lift { to { transform: translateZ(150px) translateY(-8%) scale(1.06); } }

.gpc-fly { position: fixed; z-index: 70; pointer-events: none; margin: 0; transition: left .95s cubic-bezier(.6,0,.2,1), top .95s cubic-bezier(.6,0,.2,1), width .95s cubic-bezier(.6,0,.2,1), height .95s cubic-bezier(.6,0,.2,1), opacity .5s, border-radius .95s; }
.gpc-fly.gpc-paper { background: var(--paper-2); border-radius: 2px; overflow: hidden; }
.gpc-fly.gpc-paper::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px); }

@media (max-width: 600px) {
  .gpc { --cw: 52vw; }
  .gpc-wrap.gpc-opening { transform: rotateX(8deg) translateX(calc(var(--cw) / 2)) scale(.82); }
}
`;

type CaseIntroProps = {
  gameId: string;
  slug: string;
  name: string;
  hues: Hues;
  seed: number;
  /** Real cover for the case front (generated art otherwise). */
  coverUrl: string | null;
  /** Real art for the disc label and the booklet (hero, else cover). */
  discArt: string | null;
  platformLabel: string;
  discLabel: string;
  plat: boolean;
  bookletNote: string;
  /** Logged in: whether the account already opened the game. Null: logged out (localStorage). */
  account: { opened: boolean } | null;
};

const root = () => document.getElementById(ROOT_ID);
const lockScroll = (on: boolean) => {
  document.body.style.overflow = on ? "hidden" : "";
};
/**
 * Modal (true): the dialog goes to the top layer and the rest of the document is inert, natively.
 * Modeless (false, during the disc flight): it stays on screen at its z-index, under the flying
 * clones, and the page is interactive again. `null`: closed.
 */
const setDialog = (dialog: HTMLDialogElement | null, mode: "modal" | "modeless" | null) => {
  if (!dialog) return;
  if (dialog.open) dialog.close();
  if (mode === "modal") dialog.showModal();
  else if (mode === "modeless") dialog.show();
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

export function CaseIntro(props: CaseIntroProps) {
  const { gameId, slug, name, hues, seed, coverUrl, discArt, platformLabel, discLabel, plat, bookletNote, account } = props;
  const { muted, toggleMuted } = useSound();
  const mutedRef = useRef(muted);
  const audio = useRef<AudioContext | null>(null);

  const stage = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const booklet = useRef<HTMLDivElement>(null);
  const seal = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const ui = useRef<HTMLDivElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  const run = useRef({ id: 0, running: false, timers: [] as number[], auto: 0, flies: [] as HTMLElement[] });
  const openSequenceRef = useRef<(withSound: boolean) => Promise<void>>(async () => undefined);
  /** Sound is allowed only for a sequence the visitor started with a click. */
  const soundOn = useRef(false);
  /** Null: stage not mounted. Each request to show it (first visit, replay) gets a new `n`. */
  const [staged, setStaged] = useState<{ auto: boolean; n: number } | null>(null);
  /** Height / width of the real cover, so the case takes its proportion (clamped to a plausible box). */
  const [coverRatio, setCoverRatio] = useState(1.5);

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
    seal.current?.classList.remove("gpc-peel");
    edge.current?.classList.remove("gpc-run");
    wrap.current?.classList.remove("gpc-opening");
    box.current?.classList.remove("gpc-open-case");
    slot.current?.classList.remove("gpc-lift");
    introDisc?.classList.remove("gpd-spinning");
    if (introDisc) introDisc.style.visibility = "";
    if (booklet.current) booklet.current.style.visibility = "";
    stage.current?.classList.remove("gpc-fade");
  }, []);

  const hideStage = useCallback(() => {
    stage.current?.classList.remove("gpc-on", "gpc-fade");
    setDialog(stage.current, null);
    lockScroll(false);
  }, []);

  /** Skip / Esc / reduced motion: the page as it is, at once. */
  const finishInstant = useCallback(() => {
    const wasOpen = stage.current?.classList.contains("gpc-on") ?? false;
    clearRun();
    hideStage();
    resetStage();
    revealNow();
    remember();
    if (wasOpen) document.getElementById(TITLE_ID)?.focus({ preventScroll: true });
  }, [clearRun, hideStage, remember, resetStage]);

  const showStage = useCallback(
    (autoOpen: boolean) => {
      clearRun();
      resetStage();
      window.scrollTo(0, 0);
      const w = wrap.current;
      if (w) {
        // Restart the drop-in.
        w.style.animation = "none";
        void w.offsetWidth;
        w.style.animation = "";
      }
      root()?.setAttribute("data-intro", "stage");
      stage.current?.classList.add("gpc-on");
      setDialog(stage.current, "modal");
      lockScroll(true);
      openBtn.current?.focus({ preventScroll: true });
      // The auto-open is not a gesture of the visitor: it plays silently.
      if (autoOpen) run.current.auto = window.setTimeout(() => void openSequenceRef.current(false), AUTO_OPEN_MS);
    },
    [clearRun, resetStage],
  );

  /** Clone of an element, fixed at its current box, for the FLIP flights (canvas pixels copied). */
  const flyFrom = (src: HTMLElement, extra?: string) => {
    const r = src.getBoundingClientRect();
    const f = src.cloneNode(true) as HTMLElement;
    f.classList.add("gpc-fly");
    if (extra) f.classList.add(extra);
    Object.assign(f.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      visibility: "",
    });
    const from = src.querySelectorAll("canvas");
    f.querySelectorAll("canvas").forEach((c, i) => c.getContext("2d")?.drawImage(from[i], 0, 0));
    // The clone lives outside the stage: carry the case size its type scales from.
    if (stage.current) f.style.setProperty("--cw", getComputedStyle(stage.current).getPropertyValue("--cw"));
    f.setAttribute("aria-hidden", "true");
    document.body.append(f);
    run.current.flies.push(f);
    return f;
  };

  const openSequence = async (withSound: boolean) => {
    const r = run.current;
    if (r.running) return;
    r.running = true;
    soundOn.current = withSound;
    window.clearTimeout(r.auto);
    const id = r.id;
    const wait = (ms: number) =>
      new Promise<boolean>((resolve) => {
        r.timers.push(window.setTimeout(() => resolve(r.id === id), ms));
      });

    ui.current?.classList.add("gpc-gone");
    noise({ dur: 0.55, from: 5000, to: 1800, gain: 0.18, type: "highpass" }); // lacre rasgando
    seal.current?.classList.add("gpc-peel");
    edge.current?.classList.add("gpc-run");
    if (!(await wait(650))) return;
    wrap.current?.classList.add("gpc-opening");
    box.current?.classList.add("gpc-open-case");
    if (!(await wait(900))) return;
    noise({ dur: 0.07, from: 2600, to: 900, gain: 0.5, type: "bandpass" }); // clack da capa
    tone(140, 60, 0.12, 0.18, "triangle");
    if (!(await wait(350))) return;
    const introDisc = slot.current?.querySelector<HTMLElement>(".gpd");
    introDisc?.classList.add("gpd-spinning");
    slot.current?.classList.add("gpc-lift");
    tone(180, 900, 1.1, 0.05, "sine"); // disco girando
    if (!(await wait(1000))) return;

    window.scrollTo(0, 0);
    const book = booklet.current ? flyFrom(booklet.current, "gpc-paper") : null;
    const disc = introDisc ? flyFrom(introDisc) : null;
    disc?.classList.add("gpd-spinning");
    if (introDisc) introDisc.style.visibility = "hidden";
    if (booklet.current) booklet.current.style.visibility = "hidden";
    stage.current?.classList.add("gpc-fade");
    root()?.setAttribute("data-intro", "flight");
    // Out of the top layer for the flight: the clones fly above the fading stage, the page is live.
    setDialog(stage.current, "modeless");
    lockScroll(false);
    const target = document.getElementById(HOLD_ID)?.getBoundingClientRect();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (book) Object.assign(book.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px`, opacity: "0" });
        if (disc && target) {
          Object.assign(disc.style, { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px` });
        } else if (disc) disc.style.opacity = "0";
      }),
    );
    if (!(await wait(980))) return;
    root()?.removeAttribute("data-intro");
    r.flies.forEach((f) => f.remove());
    r.flies = [];
    [523, 659, 784, 1047].forEach((f, i) => r.timers.push(window.setTimeout(() => tone(f, f, 0.5, 0.05, "triangle"), i * 90)));
    hideStage();
    resetStage();
    r.running = false;
    remember();
    document.getElementById(TITLE_ID)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    openSequenceRef.current = openSequence;
  });

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
    if (opened || reduce) {
      revealNow();
      // Keep both records in sync (account opened elsewhere / opened here while logged out).
      if (!local || (account && !account.opened)) remember();
    } else {
      // Mounting the stage is the decision itself: returning visitors never mount it. It depends on
      // browser-only state (localStorage, the motion preference), so it cannot be made while
      // rendering or hydrating; it runs once, after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStaged({ auto: true, n: 1 });
    }
    const unregister = reduce
      ? () => undefined
      : registerCaseReplay(() => setStaged((s) => ({ auto: false, n: (s?.n ?? 0) + 1 })));
    const r = run.current;
    const stageEl = stage;
    return () => {
      unregister();
      r.id++;
      r.timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(r.auto);
      r.flies.forEach((f) => f.remove());
      stageEl.current?.classList.remove("gpc-on");
      setDialog(stageEl.current, null);
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
    if (!dialog || dialog.open || !dialog.classList.contains("gpc-on")) return;
    finishInstant();
  };

  /** Keeps Tab inside the dialog while it is open. */
  const trapFocus = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab" || !stage.current) return;
    const items = [...stage.current.querySelectorAll<HTMLElement>("button")].filter(
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
      className={coverUrl ? "gpc gpc-has-cover" : "gpc"}
      style={coverUrl ? ({ "--cover-r": coverRatio } as CSSProperties) : undefined}
      aria-label={`Abrindo ${name} pela primeira vez`}
      onKeyDown={trapFocus}
      onCancel={onCancel}
      onClose={onClose}
      data-testid="case-intro"
    >
      <style href="tralked-game-case" precedence="default">
        {CSS}
      </style>
      <button
        type="button"
        className="gpc-mute"
        aria-pressed={muted}
        aria-label={muted ? "Ligar som" : "Desligar som"}
        onClick={toggleMuted}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          <path className="gpc-wave" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
        </svg>
      </button>
      <button type="button" className="gpc-skip" onClick={finishInstant}>
        Pular
      </button>
      <div ref={wrap} className="gpc-wrap">
        <div ref={box} className="gpc-case">
          <div className="gpc-tray" />
          <div className="gpc-spine">
            <span>{upper} · TRALKED</span>
          </div>
          <div className="gpc-edge" />
          <div ref={slot} className="gpc-slot">
            <Disc hues={hues} seed={seed} imageUrl={coverUrl ?? discArt} name={name} label={discLabel} plat={plat} />
          </div>
          <div className="gpc-front">
            <div className="gpc-face gpc-out">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="gpc-cover"
                  src={coverUrl}
                  alt=""
                  decoding="async"
                  draggable={false}
                  onLoad={(e) => {
                    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                    if (w > 0 && h > 0) setCoverRatio(Math.min(1.6, Math.max(1.2, h / w)));
                  }}
                />
              ) : (
                <GameArt seed={seed + 7} hues={hues} figure light width={560} height={772} />
              )}
              <div className="gpc-top">
                <b>
                  TRAL<i>K</i>ED
                </b>
                <span>{platformLabel}</span>
              </div>
              {coverUrl ? null : (
                <div className="gpc-title">
                  <b style={fit}>{name}</b>
                  <span>Edição de colecionador</span>
                </div>
              )}
              <div className="gpc-sleeve" />
            </div>
            <div className="gpc-face gpc-in">
              <i className="gpc-clip" style={{ top: "6%", left: "20%" }} />
              <i className="gpc-clip" style={{ top: "6%", right: "20%" }} />
              <i className="gpc-clip" style={{ bottom: "6%", left: "20%" }} />
              <i className="gpc-clip" style={{ bottom: "6%", right: "20%" }} />
              <div ref={booklet} className="gpc-booklet">
                <GameArt seed={seed + 8} hues={hues} imageUrl={discArt} figure width={420} height={560} />
                <div className="gpc-b-in">
                  <span>Manual</span>
                  <div>
                    <b style={fit}>{name}</b>
                    <span>{bookletNote}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div ref={seal} className="gpc-seal">
            <div className="gpc-tab">
              <span>ABRIR</span>
            </div>
          </div>
          <div ref={edge} className="gpc-seal-edge" />
        </div>
      </div>
      <div ref={ui} className="gpc-ui">
        <p>Primeira vez com este jogo</p>
        <button ref={openBtn} type="button" className="gpc-open" onClick={() => void openSequence(true)}>
          Abrir o lacre
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
