import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { Storage } from "@/lib/storage";

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

function memoryStorage() {
  const files = new Map<string, Buffer>();
  const storage: Storage = {
    name: "local",
    async put(key, data) {
      files.set(`/uploads/${key}`, data);
      return { url: `/uploads/${key}` };
    },
    async remove(url) {
      files.delete(url);
    },
  };
  return { storage, files };
}

const png = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 90 } } }).png().toBuffer();

const asFile = (data: Buffer | string, name: string, type: string) =>
  new File([typeof data === "string" ? data : new Uint8Array(data)], name, { type });

// Commits through the global client (uploadPhoto owns its transaction) and cleans up after itself.
// Safe because DB-backed test files run one at a time (see vitest.config.ts).
describe.skipIf(!reachable)("uploadPhoto", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  async function withUser(fn: (userId: string) => Promise<void>) {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.create({
      data: { handle: `upl${Date.now()}${Math.random().toString(36).slice(2, 6)}`, displayName: "Uploader" },
    });
    try {
      await fn(user.id);
    } finally {
      await prisma.photo.deleteMany({ where: { authorId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  it("refuses fake image types, unknown games and missing files without storing anything", () =>
    withUser(async (userId) => {
      const { uploadPhoto } = await import("./upload");
      const { storage, files } = memoryStorage();
      const deps = { storage };

      const fake = await uploadPhoto(
        { userId, file: asFile("<?php echo 1; ?>", "foto.jpg", "image/jpeg"), gameSlug: "hollow-knight", caption: "" },
        deps,
      );
      expect(fake).toMatchObject({ status: "invalid", field: "foto" });

      const svg = asFile('<svg xmlns="http://www.w3.org/2000/svg"/>', "foto.png", "image/png");
      expect(await uploadPhoto({ userId, file: svg, gameSlug: "hollow-knight", caption: "" }, deps)).toMatchObject({
        status: "invalid",
        field: "foto",
      });

      const real = asFile(await png(), "foto.png", "image/png");
      expect(await uploadPhoto({ userId, file: real, gameSlug: "nao-existe", caption: "" }, deps)).toMatchObject({
        status: "invalid",
        field: "jogo",
      });
      expect(await uploadPhoto({ userId, file: null, gameSlug: "hollow-knight", caption: "" }, deps)).toMatchObject({
        status: "invalid",
        field: "foto",
      });
      expect(
        await uploadPhoto({ userId, file: real, gameSlug: "hollow-knight", caption: "<b>oi</b>" }, deps),
      ).toMatchObject({ status: "invalid", field: "legenda" });

      const big = asFile(Buffer.alloc(8 * 1024 * 1024 + 1), "foto.jpg", "image/jpeg");
      expect(await uploadPhoto({ userId, file: big, gameSlug: "hollow-knight", caption: "" }, deps)).toMatchObject({
        status: "too_large",
      });

      expect(files.size).toBe(0);
      const { prisma } = await import("@/lib/db");
      expect(await prisma.photo.count({ where: { authorId: userId } })).toBe(0);
    }));

  it("stores WebP, creates a visible photo and stops paying XP after 3 photos a day", () =>
    withUser(async (userId) => {
      const { uploadPhoto } = await import("./upload");
      const { prisma } = await import("@/lib/db");
      const { storage, files } = memoryStorage();
      const now = new Date();

      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push(
          await uploadPhoto(
            { userId, file: asFile(await png(), `f${i}.png`, "image/png"), gameSlug: "hades", caption: ` Foto ${i} ` },
            { storage, now },
          ),
        );
      }
      expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
      expect(results.map((r) => r.status === "ok" && r.xpAwarded)).toEqual([true, true, true, false]);

      const photos = await prisma.photo.findMany({ where: { authorId: userId }, include: { game: true } });
      expect(photos).toHaveLength(4);
      expect(photos.every((p) => p.status === "visible" && p.game?.slug === "hades" && p.width === 64)).toBe(true);
      expect(photos.map((p) => p.caption).sort()).toEqual(["Foto 0", "Foto 1", "Foto 2", "Foto 3"]);
      for (const p of photos) {
        expect((await sharp(files.get(p.url!)!).metadata()).format).toBe("webp");
      }

      const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId, source: "photo_approved" } });
      expect(ledger).toHaveLength(3);
      const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId } });
      expect(stats.totalXp).toBe(150);
    }));

  it("allows at most 10 uploads a day", () =>
    withUser(async (userId) => {
      const { uploadPhoto } = await import("./upload");
      const { prisma } = await import("@/lib/db");
      await prisma.photo.createMany({
        data: Array.from({ length: 10 }, () => ({ authorId: userId, width: 1, height: 1 })),
      });
      const { storage, files } = memoryStorage();
      const result = await uploadPhoto(
        { userId, file: asFile(await png(), "f.png", "image/png"), gameSlug: "hades", caption: "" },
        { storage },
      );
      expect(result.status).toBe("rate_limited");
      expect(files.size).toBe(0);
    }));
});
