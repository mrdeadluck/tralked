"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { ContentBlock } from "@/lib/content/schema";

type GalleryBlock = Extract<ContentBlock, { type: "gallery" }>;
type GalleryImage = GalleryBlock["images"][number];

const LINK = "underline decoration-1 underline-offset-[3px] hover:text-text-2";
const NAV =
  "inline-flex size-10 cursor-pointer items-center justify-center rounded-[2px] border border-line-2 bg-bg/80 font-mono text-lg text-text-2 hover:border-text hover:text-text";

function Credit({ image }: { image: Pick<GalleryImage, "credit" | "creditUrl"> }) {
  return (
    <>
      Crédito:{" "}
      {image.creditUrl ? (
        <a href={image.creditUrl} target="_blank" rel="noopener noreferrer nofollow" className={LINK}>
          {image.credit}
        </a>
      ) : (
        image.credit
      )}
    </>
  );
}

/**
 * Official images of news about new images: 2 columns on phones, 3 from 640 px. A thumbnail opens the
 * image big in a modal `<dialog>` (focus stays inside); ← and → move between images, Esc closes and
 * focus goes back to the thumbnail. One credit for the gallery when all images share it.
 */
export function Gallery({ block }: { block: GalleryBlock }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const opener = useRef(0);
  const [index, setIndex] = useState(0);
  const images = block.images;
  const shared = images.every((i) => i.credit === images[0].credit && i.creditUrl === images[0].creditUrl);
  const current = images[index];

  const open = (i: number) => {
    opener.current = i;
    setIndex(i);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const move = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else return;
    e.preventDefault();
  };

  return (
    <figure className="my-4 flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image, i) => (
          <li key={image.url} className="flex flex-col gap-1">
            <button
              type="button"
              ref={(el) => {
                thumbs.current[i] = el;
              }}
              onClick={() => open(i)}
              aria-label={`Ampliar: ${image.alt}`}
              className="block aspect-video cursor-zoom-in overflow-hidden rounded-[3px] bg-surface focus-visible:outline-2 focus-visible:outline-(--acc)"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- images hosted by us (Vercel Blob), any size */}
              <img src={image.url} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform hover:scale-[1.03]" />
            </button>
            {shared ? null : (
              <span className="font-mono text-xs text-dim">
                <Credit image={image} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {shared ? (
        <figcaption className="font-mono text-xs text-dim">
          <Credit image={images[0]} />
        </figcaption>
      ) : null}

      <dialog
        ref={dialog}
        aria-label={`Galeria: imagem ${index + 1} de ${images.length}`}
        onKeyDown={onKeyDown}
        onClose={() => thumbs.current[opener.current]?.focus()}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className="m-auto max-h-[100dvh] max-w-[min(1280px,100vw)] bg-transparent p-4 text-text backdrop:bg-black/85"
      >
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- images hosted by us (Vercel Blob), any size */}
          <img src={current.url} alt={current.alt} className="max-h-[78dvh] w-auto max-w-full rounded-[3px] object-contain" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-dim">
              {index + 1}/{images.length} · {current.alt} · <Credit image={current} />
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => move(-1)} aria-label="Imagem anterior" className={NAV}>
                ←
              </button>
              <button type="button" onClick={() => move(1)} aria-label="Próxima imagem" className={NAV}>
                →
              </button>
              <button type="button" onClick={close} aria-label="Fechar" className={NAV}>
                ×
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </figure>
  );
}
