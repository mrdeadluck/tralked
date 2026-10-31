import { blobStorage } from "./blob";
import { localStorage } from "./local";

/** Where gallery images live. `key` is a relative path such as `2026/10/<id>.webp`. */
export interface Storage {
  readonly name: "local" | "blob";
  /** Stores the bytes and returns the public URL to put in `<img src>`. */
  put(key: string, data: Buffer, contentType: string): Promise<{ url: string }>;
  /** Best-effort removal of something this adapter stored (used when a later step fails). */
  remove(url: string): Promise<void>;
}

/** `yyyy/mm/<id>.webp` for an upload stored at `date`. */
export function uploadKey(id: string, date: Date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${id}.webp`;
}

/**
 * Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (production), otherwise the local adapter that
 * writes to `public/uploads` (development; works without any key).
 */
export function getStorage(): Storage {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? blobStorage(token) : localStorage();
}
