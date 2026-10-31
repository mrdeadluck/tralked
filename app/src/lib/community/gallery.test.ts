import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

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

describe.skipIf(!reachable)("gallery queries (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("recentPhotoIds never prerenders a private profile's photo", async () => {
    const { prisma } = await import("@/lib/db");
    const { recentPhotoIds } = await import("./gallery");
    const tag = `galpriv${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const [hidden, open] = await Promise.all([
      prisma.user.create({ data: { handle: `${tag}-h`, displayName: "Privado", profilePublic: false } }),
      prisma.user.create({ data: { handle: `${tag}-o`, displayName: "Público", profilePublic: true } }),
    ]);
    // Newer than any seeded photo, so both are among the most recent.
    const future = new Date("2100-01-01T00:00:00Z");
    try {
      const [privatePhoto, publicPhoto] = await Promise.all([
        prisma.photo.create({ data: { authorId: hidden.id, url: "/uploads/x.webp", width: 10, height: 10, createdAt: future } }),
        prisma.photo.create({ data: { authorId: open.id, url: "/uploads/y.webp", width: 10, height: 10, createdAt: future } }),
      ]);
      const ids = await recentPhotoIds(5);
      expect(ids).toContain(publicPhoto.id);
      expect(ids).not.toContain(privatePhoto.id);
    } finally {
      await prisma.photo.deleteMany({ where: { authorId: { in: [hidden.id, open.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [hidden.id, open.id] } } });
    }
  });
});
