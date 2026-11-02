"use client";

import { useEffect, useRef, useState } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { titleFitStyle } from "@/components/game/title-fit";
import type { CaseArtSource } from "@/lib/case-art";

/**
 * The art inside a shelf case: the first source that loads (a failed image moves on to the next,
 * also when it failed before hydration), and the generated art with the game's name at the end.
 */
export function CaseCover({ name, art, seed, hues }: { name: string; art: CaseArtSource[]; seed: number; hues: Hues }) {
  const [index, setIndex] = useState(0);
  const img = useRef<HTMLImageElement>(null);
  const source = art[index];
  const next = () => setIndex((i) => i + 1);

  // An image that 404'd before React attached onError is "complete" with no pixels.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setIndex((i) => i + 1);
  }, [index]);

  if (!source) {
    return (
      <>
        <GameArt seed={seed} hues={hues} figure width={300} height={414} />
        <span className="cs-top" />
        <span className="cs-nm" aria-hidden="true" style={titleFitStyle(name)}>
          {name}
        </span>
      </>
    );
  }

  if (source.wide) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art, as GameCover */}
        <img src={source.url} alt="" aria-hidden="true" className="cs-blur" loading="lazy" decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art, as GameCover */}
        <img
          key={source.url}
          ref={img}
          src={source.url}
          alt=""
          className="cs-wide"
          loading="lazy"
          decoding="async"
          onError={next}
        />
      </>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- hosts vary (IGDB, SteamGridDB, Steam)
    <img
      key={source.url}
      ref={img}
      src={source.url}
      alt=""
      className="cs-img"
      loading="lazy"
      decoding="async"
      onError={next}
    />
  );
}
