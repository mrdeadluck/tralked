import { PhotoArt } from "./PhotoArt";

type PhotoMediaProps = {
  id: string;
  url: string | null;
  width: number;
  height: number;
  gameSlug?: string | null;
  /** Alt text for real photos (the generated art is decorative). */
  alt: string;
  /** cover = fill the box (grid tiles); contain = whole image (photo page). */
  fit?: "cover" | "contain";
  eager?: boolean;
};

/** A gallery photo: the uploaded WebP when there is one, otherwise generated art (seed data). */
export function PhotoMedia({ id, url, width, height, gameSlug, alt, fit = "cover", eager = false }: PhotoMediaProps) {
  if (!url) return <PhotoArt seed={id} gameSlug={gameSlug} width={width} height={height} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- uploads live on Vercel Blob or public/uploads; already resized WebP
    <img
      src={url}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`block size-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
    />
  );
}
