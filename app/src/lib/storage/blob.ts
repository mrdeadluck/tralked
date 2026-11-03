import type { Storage } from "./index";

/** Cache lifetime (seconds) of user uploads on the Blob CDN and in browsers. */
export const UPLOAD_CACHE_MAX_AGE_S = 60 * 60 * 24;

/** Blob folder of the community gallery. */
export const GALLERY_PREFIX = "galeria";

/**
 * Production adapter on Vercel Blob. The SDK is imported lazily, so it never loads in
 * development or tests (where `BLOB_READ_WRITE_TOKEN` is unset).
 */
export function blobStorage(token: string, prefix: string = GALLERY_PREFIX): Storage {
  return {
    name: "blob",
    async put(key, data, contentType) {
      const { put } = await import("@vercel/blob");
      const result = await put(`${prefix}/${key}`, data, {
        access: "public",
        contentType,
        token,
        // Keys contain a fresh cuid, so a collision means a bug: never overwrite silently.
        allowOverwrite: false,
        // One day, not a year: names are ids (not content hashes), and a photo removed by
        // moderation is deleted, so CDN and browser copies must expire soon after.
        cacheControlMaxAge: UPLOAD_CACHE_MAX_AGE_S,
      });
      return { url: result.url };
    },
    async remove(url) {
      const { del } = await import("@vercel/blob");
      await del(url, { token });
    },
  };
}
