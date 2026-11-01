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

      // The photo page of a private profile is a 404 too; it comes back when the profile does.
      const { getPhoto } = await import("./gallery");
      expect(await getPhoto(privatePhoto.id)).toBeNull();
      expect(await getPhoto(publicPhoto.id)).toMatchObject({ id: publicPhoto.id });
      await prisma.user.update({ where: { id: hidden.id }, data: { profilePublic: true } });
      expect(await getPhoto(privatePhoto.id)).toMatchObject({ id: privatePhoto.id });

      // Flipping the visibility reports the change, and the tags cover the user's photo pages.
      const { updateProfileSettings } = await import("@/lib/accounts/settings");
      const { visibilityTags } = await import("@/lib/accounts/privacy");
      expect(await updateProfileSettings(hidden.id, { bio: "", profilePublic: false })).toEqual({ visibilityChanged: true });
      expect(await updateProfileSettings(hidden.id, { bio: "", profilePublic: false })).toEqual({ visibilityChanged: false });
      expect((await visibilityTags(hidden.id)).sort()).toEqual(
        ["gallery", "forum", "highscores", `photo:${privatePhoto.id}`, `player:${hidden.handle.toLowerCase()}`].sort(),
      );
    } finally {
      await prisma.photo.deleteMany({ where: { authorId: { in: [hidden.id, open.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [hidden.id, open.id] } } });
    }
  });
});
