import type { Storage } from "./index";

/**
 * Production adapter on Vercel Blob. The SDK is imported lazily, so it never loads in
 * development or tests (where `BLOB_READ_WRITE_TOKEN` is unset).
 */
export function blobStorage(token: string): Storage {
  return {
    name: "blob",
    async put(key, data, contentType) {
      const { put } = await import("@vercel/blob");
      const result = await put(`galeria/${key}`, data, {
        access: "public",
        contentType,
        token,
        // Keys contain a fresh cuid, so a collision means a bug: never overwrite silently.
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      });
      return { url: result.url };
    },
    async remove(url) {
      const { del } = await import("@vercel/blob");
      await del(url, { token });
    },
  };
}
