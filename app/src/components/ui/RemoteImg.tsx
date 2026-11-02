"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { sizedImage, type ArtShape } from "@/lib/images/sized";

type RemoteImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes" | "width" | "height" | "alt"> & {
  /** Hotlinked art (IGDB, Steam, SteamGridDB…), as stored. */
  url: string;
  /** Empty for decorative art (its name is next to it). */
  alt: string;
  /** Widest the image renders, in CSS px: the CDN copy that covers it is requested. */
  width: number;
  height: number;
  /** `sizes` for the CDN copies' srcset (the browser picks one for the screen's density). */
  sizes: string;
  /** `wide` boxes take 16:9 crops; `fit` (covers, images shown whole) uncropped sizes. */
  shape?: ArtShape;
  /** The original failed too (after the fallback): the caller shows its placeholder. */
  onFail?: () => void;
};

/**
 * A hotlinked image at the size it is shown (lib/images/sized.ts), lazy by default, with explicit
 * dimensions. A guessed CDN thumbnail that does not exist moves on to its fallbacks (the original
 * last); when those fail too, `onFail` lets the caller show its placeholder.
 */
export function RemoteImg({ url, alt, width, height, sizes, shape = "wide", onFail, loading = "lazy", ...rest }: RemoteImgProps) {
  const sized = sizedImage(url, width, shape);
  const fallbacks = sized.fallbacks ?? [];
  const [failed, setFailed] = useState<{ url: string; count: number } | null>(null);
  const step = failed && failed.url === url ? failed.count : 0;
  const img = useRef<HTMLImageElement>(null);

  const onError = () => {
    if (step < fallbacks.length) setFailed({ url, count: step + 1 });
    else onFail?.();
  };

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  // An image that failed before React attached onError is "complete" with no pixels (currentSrc:
  // the browser did try it; a lazy image not requested yet is not a failure).
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.currentSrc && el.naturalWidth === 0) onErrorRef.current();
  }, [step, url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked art: these CDNs serve the size asked for (no optimizer quota)
    <img
      ref={img}
      key={step}
      src={step === 0 ? sized.src : fallbacks[step - 1]}
      alt={alt}
      srcSet={step === 0 ? sized.srcSet : undefined}
      sizes={step === 0 && sized.srcSet ? sizes : undefined}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      onError={onError}
      {...rest}
    />
  );
}
