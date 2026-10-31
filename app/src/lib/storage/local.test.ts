import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getStorage, uploadKey } from "./index";
import { localStorage } from "./local";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("storage", () => {
  it("builds yyyy/mm keys", () => {
    expect(uploadKey("abc", new Date("2026-03-05T12:00:00Z"))).toBe("2026/03/abc.webp");
  });

  it("local adapter writes under public/uploads and removes what it wrote", async () => {
    root = await mkdtemp(path.join(tmpdir(), "tralked-uploads-"));
    const storage = localStorage(root);
    const { url } = await storage.put("2026/10/foto.webp", Buffer.from("webp"), "image/webp");
    expect(url).toBe("/uploads/2026/10/foto.webp");
    const file = path.join(root, "public", "uploads", "2026", "10", "foto.webp");
    expect((await readFile(file)).toString()).toBe("webp");

    await storage.remove(url);
    await expect(readFile(file)).rejects.toThrow();
  });

  it("local adapter refuses keys that escape the uploads folder", async () => {
    root = await mkdtemp(path.join(tmpdir(), "tralked-uploads-"));
    const storage = localStorage(root);
    await expect(storage.put("../../evil.webp", Buffer.from("x"), "image/webp")).rejects.toThrow(/Unsafe/);
    await expect(storage.put("2026/10/x.html", Buffer.from("x"), "image/webp")).rejects.toThrow(/Unsafe/);
  });

  it("uses Blob only when BLOB_READ_WRITE_TOKEN is set", () => {
    const previous = process.env.BLOB_READ_WRITE_TOKEN;
    try {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      expect(getStorage().name).toBe("local");
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_example";
      expect(getStorage().name).toBe("blob");
    } finally {
      if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previous;
    }
  });
});
