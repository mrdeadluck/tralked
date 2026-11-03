"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/*
 * The game page's <h1>: the official logo when the game has one (its alt is the game's name, so
 * the heading reads the same), else the name set in the fitted display type. The logo sits in a
 * fixed-height box, so nothing moves when it loads; if it fails (before or after hydration), the
 * name takes its place.
 */
export function HeroTitle({ name, logoUrl, style }: { name: string; logoUrl: string | null; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // An error before hydration fires no React event: read the image's own state once.
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);

  const logo = logoUrl && !failed;
  return (
    <h1 id="gp-title" tabIndex={-1} className={logo ? "gps-title gps-logo gp-veil" : "gps-title gp-veil"} style={style}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={logoUrl} alt={name} decoding="async" fetchPriority="high" onError={() => setFailed(true)} />
      ) : (
        name
      )}
    </h1>
  );
}
