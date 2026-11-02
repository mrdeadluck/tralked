"use client";

import { useEffect, useRef, useState } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { titleFitStyle } from "@/components/game/title-fit";
import type { CaseArtSource } from "@/lib/case-art";
import { sizedImage } from "@/lib/images/sized";

/** A case is 140–200 px wide (CaseShelf's grid): request that size from the CDN. */
const CASE_WIDTH = 200;
const CASE_SIZES = "200px";

type Attempt = { src: string; srcSet?: string; wide: boolean };

/** Each source at the case's size; a guessed CDN thumbnail is followed by its fallbacks (the original last). */
function attemptsOf(art: CaseArtSource[]): Attempt[] {
  return art.flatMap((source) => {
    const sized = sizedImage(source.url, CASE_WIDTH, source.wide ? "wide" : "fit");
    return [
      { src: sized.src, srcSet: sized.srcSet, wide: source.wide },
      ...(sized.fallbacks ?? []).map((src) => ({ src, wide: source.wide })),
    ];
  });
}

/**
 * The art inside a shelf case: the first source that loads (a failed image moves on to the next,
 * also when it failed before hydration), and the generated art with the game's name at the end.
 */
export function CaseCover({ name, art, seed, hues }: { name: string; art: CaseArtSource[]; seed: number; hues: Hues }) {
  const [index, setIndex] = useState(0);
  const img = useRef<HTMLImageElement>(null);
  const source = attemptsOf(art)[index];
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

  const sizes = source.srcSet ? CASE_SIZES : undefined;

  if (source.wide) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art, as GameCover */}
        <img
          src={source.src}
          srcSet={source.srcSet}
          sizes={sizes}
          alt=""
          aria-hidden="true"
          className="cs-blur"
          loading="lazy"
          decoding="async"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art, as GameCover */}
        <img
          key={source.src}
          ref={img}
          src={source.src}
          srcSet={source.srcSet}
          sizes={sizes}
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
      key={source.src}
      ref={img}
      src={source.src}
      srcSet={source.srcSet}
      sizes={sizes}
      alt=""
      className="cs-img"
      loading="lazy"
      decoding="async"
      onError={next}
    />
  );
}
