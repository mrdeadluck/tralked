import sharp from "sharp";

/** Largest accepted upload, in bytes. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Longest side of the stored image, in pixels. */
export const MAX_DIMENSION = 2048;
/** Decoding guard against "pixel bombs": a small file that claims a huge canvas. */
const MAX_INPUT_PIXELS = 50_000_000;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ProcessedImage = { data: Buffer; width: number; height: number };

export type ImageRejection = "too_large" | "invalid_type";

export class ImageRejectedError extends Error {
  constructor(readonly reason: ImageRejection) {
    super(reason === "too_large" ? "Image is larger than 8 MB" : "Not a JPEG, PNG or WebP image");
  }
}

/**
 * Validates an uploaded image by decoding it (the declared MIME type and file name are ignored)
 * and re-encodes it as WebP: auto-oriented, at most 2048 px on the longest side, no metadata
 * (EXIF, GPS and ICC are dropped by sharp's default output). Throws `ImageRejectedError`.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new ImageRejectedError("too_large");
  if (input.byteLength === 0) throw new ImageRejectedError("invalid_type");

  const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true } as const;
  let format: string | undefined;
  try {
    format = (await sharp(input, options).metadata()).format;
  } catch {
    throw new ImageRejectedError("invalid_type");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) throw new ImageRejectedError("invalid_type");

  try {
    const { data, info } = await sharp(input, options)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    // Valid header but corrupt or truncated pixel data.
    throw new ImageRejectedError("invalid_type");
  }
}
