import { CLIENT_WEBP_QUALITY, MAX_DIMENSION } from "@/lib/community/upload-limits";

/** Size that fits inside `max`×`max` keeping the aspect ratio, never enlarging. */
export function fitWithin(width: number, height: number, max: number = MAX_DIMENSION) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrinks a chosen photo in the browser before upload: at most 2048 px on the longest side,
 * re-encoded as WebP (JPEG where the browser cannot encode WebP). Keeps uploads small enough for
 * the platform's request limit. The server still decodes and re-encodes whatever arrives.
 * Returns null when the browser cannot decode the file (the server then gives the real error).
 */
export async function compressForUpload(file: File): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);

    let blob = await toBlob(canvas, "image/webp", CLIENT_WEBP_QUALITY);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", CLIENT_WEBP_QUALITY);
    if (!blob) return null;
    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `foto.${extension}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
