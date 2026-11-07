"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isOptimizedUrl, logoImage } from "@/lib/images/sized";

/*
 * The game page's <h1>: the official logo when the game has one (its alt is the game's name, so
 * the heading reads the same), else the name set in the fitted display type. The logo sits in a
 * fixed-height box, so nothing moves when it loads; if it fails (before or after hydration), the
 * name takes its place. SteamGridDB logos come through the image optimizer (WebP), the original
 * being the next try. No high fetch priority: on a slow phone it took bandwidth from the hero art
 * (the page's largest paint), and first visits veil the title until the case intro ends anyway.
 */
export function HeroTitle({ name, logoUrl, style }: { name: string; logoUrl: string | null; style?: CSSProperties }) {
  // 0: optimized copies, 1: the original logo, 2: the name in type.
  const [step, setStep] = useState(0);
  const img = useRef<HTMLImageElement>(null);
  const sized = logoUrl ? logoImage(logoUrl) : null;
  const srcs = sized ? [sized.src, ...(sized.fallbacks ?? [])] : [];
  const src = srcs[step];
  const next = () => setStep((s) => s + 1);

  useEffect(() => {
    // An error before hydration fires no React event: read the image's own state once.
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setStep((s) => s + 1);
  }, []);

  const logo = Boolean(src);
  return (
    <h1 id="gp-title" tabIndex={-1} className={logo ? "gps-title gps-logo gp-veil" : "gps-title gp-veil"} style={style}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={img}
          key={src}
          src={src}
          srcSet={isOptimizedUrl(src) ? sized?.srcSet : undefined}
          sizes={isOptimizedUrl(src) ? "(max-width: 700px) 90vw, 620px" : undefined}
          alt={name}
          decoding="async"
          onError={next}
        />
      ) : (
        name
      )}
    </h1>
  );
}
