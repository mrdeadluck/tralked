"use client";

import { useState } from "react";
import { noteFailedImage, sizedImage, type ArtShape } from "@/lib/images/sized";

/**
 * `url` at the size of its box (lib/images/sized) for a plain `<img>`, with the fallback chain of a
 * guessed CDN thumbnail: returns the src to show and the `onError` that moves on (the original
 * last). Null when there is no url.
 */
export function useSizedSrc(
  url: string | null,
  width: number,
  shape: ArtShape,
): { src: string; onError: () => void } | null {
  const [failed, setFailed] = useState<string[]>([]);
  if (!url) return null;
  const sized = sizedImage(url, width, shape);
  const candidates = [sized.src, ...(sized.fallbacks ?? [])];
  const src = candidates.find((c) => !failed.includes(c)) ?? candidates[candidates.length - 1];
  return {
    src,
    onError: () => {
      if (src === candidates[candidates.length - 1]) return;
      noteFailedImage(src);
      setFailed((list) => (list.includes(src) ? list : [...list, src]));
    },
  };
}
