import sharp from "sharp";
import type { FetchFn } from "../collect/index.js";

/** An image downloaded for an article: its bytes, measured, with a perceptual fingerprint. */
export type FetchedImage = {
  url: string;
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  width: number;
  height: number;
  hash: bigint;
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Two copies of one picture (another CDN, another size, another JPEG quality) differ by at most this many
 * of the 64 dHash bits; different pictures differ by far more.
 */
export const SAME_IMAGE_MAX_DISTANCE = 6;

const TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;

/**
 * dHash: the picture in grey at 9×8, one bit per pixel saying whether it is darker than its right
 * neighbour. Survives resizing and recompression, so the same image on two sites hashes alike.
 */
export async function dHash(bytes: Buffer): Promise<bigint> {
  const px = await sharp(bytes).flatten({ background: "#ffffff" }).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (px[y * 9 + x]! < px[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let v = a ^ b;
  let n = 0;
  while (v > 0n) {
    n += Number(v & 1n);
    v >>= 1n;
  }
  return n;
}

/**
 * Downloads an image for an article: https only, at most 8 MiB, an image content-type, decodable by sharp.
 * JPEG, PNG, WebP and GIF stay as they are; other raster formats (AVIF, HEIF, TIFF) become WebP, which the
 * site's media API takes. Never throws: anything wrong is `null`.
 */
export async function fetchImage(url: string, fetchFn: FetchFn): Promise<FetchedImage | null> {
  if (!URL.canParse(url) || new URL(url).protocol !== "https:") return null;
  try {
    const res = await fetchFn(url, {
      headers: { accept: "image/webp,image/jpeg,image/png,image/*;q=0.8", "user-agent": "Mozilla/5.0 (compatible; TralkedBot/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("image/") || type.includes("svg")) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    let bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;

    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    let contentType: FetchedImage["contentType"] | undefined = TYPES[meta.format as keyof typeof TYPES];
    if (!contentType) {
      if (meta.format === "svg") return null;
      bytes = await sharp(bytes).webp({ quality: 90 }).toBuffer();
      contentType = "image/webp";
    }
    return { url, bytes, contentType, width: meta.width, height: meta.height, hash: await dHash(bytes) };
  } catch {
    return null;
  }
}
