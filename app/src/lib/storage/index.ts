import { blobStorage, GALLERY_PREFIX } from "./blob";
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

/** Production without `BLOB_READ_WRITE_TOKEN`: there is nowhere to store images. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Image storage is not configured: set BLOB_READ_WRITE_TOKEN in production.");
  }
}

/**
 * Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (production), otherwise the local adapter that
 * writes to `public/uploads` (development; works without any key). In production the token is
 * required: a production server does not serve new files from `public/` (and Vercel's disk is
 * read-only), so it throws StorageNotConfiguredError instead of writing to local disk.
 */
export function getStorage(prefix: string = GALLERY_PREFIX): Storage {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return blobStorage(token, prefix);
  if (process.env.NODE_ENV === "production") throw new StorageNotConfiguredError();
  return localStorage(process.cwd(), prefix === GALLERY_PREFIX ? undefined : prefix);
}
