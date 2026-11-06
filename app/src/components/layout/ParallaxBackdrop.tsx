"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markContentPanels } from "./content-panels";
import { CAST } from "./parallax-cast";
import {
  MOBILE_MAX_WIDTH,
  backdropModeFor,
  clamp,
  depthAt,
  figurePose,
  markPulses,
  ribbonForSlot,
  ribbonPose,
  stagePixels,
} from "./parallax-motion";

/*
 * Page backdrop: the approved parallax scene (tralked-parallax-preview). Home, Notícias and
 * Comunidade show the cast of characters cut out of official art, the lime TRALKED ribbons and the
 * emblem/wordmark on the passages; every other page shows the same without the characters. Fixed behind
 * everything, decorative only (aria-hidden, no pointer events). Driven by native scroll: one
 * requestAnimationFrame per scroll burst, no loops, no scroll capture. With reduced motion the
 * opening composition stays still. Character art downloads only when its turn comes near.
 * Styles: parallax-backdrop.css. Math: parallax-motion.ts. It also keeps the content panels marked
 * (content-panels.ts), the boxes that keep the page's blocks readable over the scene.
 */

const WORDMARK = "/parallax/wordmark.svg";
const EMBLEM = "/parallax/emblem.svg";

function RibbonTrack() {
  return (
    <div className="ribbon-track">
      {[0, 1, 2].map((i) => (
        <span key={i}>
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative brand SVG */}
          <img src={WORDMARK} alt="" />
          <b>!</b>
          <small>100%</small>
        </span>
      ))}
    </div>
  );
}

export function ParallaxBackdrop() {
  const pathname = usePathname();
  const mode = backdropModeFor(pathname);
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const figures = [...scene.querySelectorAll<HTMLElement>(".figure")];
    const ribbons = [...scene.querySelectorAll<HTMLElement>(".achievement-ribbon")];
    const word = scene.querySelector<HTMLElement>(".transition-word");
    const mark = scene.querySelector<HTMLElement>(".world-mark");
    const distant = scene.querySelector<HTMLElement>(".distant");
    const mist = scene.querySelector<HTMLElement>(".mist");
    const dust = scene.querySelector<HTMLElement>(".dust");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");

    let viewport = innerHeight;
    let mobile = innerWidth <= MOBILE_MAX_WIDTH;
    let maxScroll = 1;
    let queued = false;

    const load = (el: HTMLElement) => {
      const img = el.querySelector("image");
      if (img && !img.hasAttribute("href") && img.dataset.href) img.setAttribute("href", img.dataset.href);
    };

    const render = () => {
      queued = false;
      const t = reduce.matches ? 0 : scrollY / stagePixels(viewport, mobile, mode, maxScroll);

      for (const el of figures) {
        const center = Number(el.dataset.center);
        const pose = figurePose(t, center, {
          side: el.classList.contains("left") ? "left" : "right",
          back: Number(el.style.zIndex) < 2,
          viewport,
          mobile,
        });
        if (pose.opacity > 0.01 || Math.abs(t - center) < 1.65) load(el);
        el.style.transform = pose.transform;
        el.style.opacity = pose.opacity.toFixed(3);
        el.style.visibility = pose.opacity > 0.003 ? "visible" : "hidden";
      }

      ribbons.forEach((el, slot) => {
        const k = ribbonForSlot(t, slot as 0 | 1);
        const pose = ribbonPose(t, k, mobile);
        el.style.transform = pose.transform;
        el.style.opacity = String(pose.opacity);
        el.style.visibility = pose.opacity > 0.002 ? "visible" : "hidden";
        // The opening ribbon sits between the far and near characters; the later ones behind both.
        el.style.zIndex = k === 0 ? "2" : "0";
      });

      const depth = depthAt(t);
      if (mark && word) {
        const { word: wordPulse, symbol } = markPulses(t);
        mark.style.opacity = String(0.25 * symbol);
        mark.style.transform = `translate3d(calc(-50% + ${Math.sin(depth * 0.9) * (mobile ? 16 : 45)}px),${-depth * (mobile ? 17 : 32)}px,0) scale(${1 + depth * 0.025})`;
        word.style.opacity = String(0.25 * wordPulse);
        word.style.transform = `translate3d(calc(-50% + ${Math.sin(depth) * 24}px),${-depth * (mobile ? 13 : 24)}px,0) scale(${1 + depth * 0.018})`;
      }
      if (distant) distant.style.transform = `translate3d(0,${-depth * 12}px,0)`;
      if (mist) mist.style.transform = `translate3d(${depth * 12}px,${-depth * 26}px,0)`;
      if (dust) dust.style.transform = `translate3d(0,${-depth * 43}px,0)`;
    };

    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    };
    const measure = () => {
      viewport = innerHeight;
      mobile = innerWidth <= MOBILE_MAX_WIDTH;
      maxScroll = clamp(document.documentElement.scrollHeight - innerHeight, 1, Infinity);
      schedule();
    };

    measure();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", measure, { passive: true });
    reduce.addEventListener("change", schedule);
    // Content that grows after load (images, streamed sections) changes the page height.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    const images = figures.map((el) => el.querySelector("image")).filter((img) => img !== null);
    for (const img of images) img.addEventListener("load", schedule);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", measure);
      reduce.removeEventListener("change", schedule);
      observer.disconnect();
      for (const img of images) img.removeEventListener("load", schedule);
    };
  }, [mode]);

  // Content panels: re-marked whenever the page's content or size changes (navigation, streaming,
  // client-side filters, resize).
  useEffect(() => {
    const main = document.getElementById("principal");
    if (!main) return;
    let queued = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const run = () => {
      queued = false;
      clearTimeout(retry);
      // Streamed sections hydrate a little after they show up: try again shortly (for ~10 s).
      if (markContentPanels() === "pending" && tries++ < 60) retry = setTimeout(schedule, 150);
      else tries = 0;
    };
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(run);
      }
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(main);
    const mutations = new MutationObserver(schedule);
    mutations.observe(main, { childList: true, subtree: true });
    addEventListener("resize", schedule, { passive: true });
    return () => {
      clearTimeout(retry);
      resize.disconnect();
      mutations.disconnect();
      removeEventListener("resize", schedule);
    };
  }, [pathname]);

  const full = mode === "full";
  return (
    <div ref={sceneRef} className="tk-scene" data-mode={mode} aria-hidden="true">
      <div className="distant" />
      {full &&
        CAST.map((c) => (
          <div key={c.key} className={`figure ${c.key} ${c.side}`} data-center={c.center} style={{ zIndex: c.z }}>
            <div className="rim">
              <svg viewBox={c.viewBox} xmlns="http://www.w3.org/2000/svg">
                {c.clip && (
                  <defs>
                    <clipPath id={`tk-clip-${c.key}`}>
                      <path d={c.clip} clipRule={c.clipRule ?? undefined} />
                    </clipPath>
                  </defs>
                )}
                <image
                  data-href={c.src}
                  width={c.width}
                  height={c.height}
                  clipPath={c.clip ? `url(#tk-clip-${c.key})` : undefined}
                />
              </svg>
            </div>
          </div>
        ))}
      {/* Slot 0 starts as the opening ribbon (visible before the first frame, like the preview). */}
      <div className="achievement-ribbon" style={{ opacity: 0.48, zIndex: 2 }}>
        <RibbonTrack />
      </div>
      <div className="achievement-ribbon" style={{ opacity: 0, zIndex: 0, visibility: "hidden" }}>
        <RibbonTrack />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative brand SVG */}
      <img className="transition-word" src={WORDMARK} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative brand SVG */}
      <img className="world-mark" src={EMBLEM} alt="" />
      <div className="mist" />
      <div className="dust" />
      <div className="reading-shade" />
    </div>
  );
}
