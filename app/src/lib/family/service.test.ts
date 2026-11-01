import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs the seeded Postgres (`pnpm db:up && pnpm db:migrate && pnpm db:seed`); skipped otherwise.
// Every row created here is prefixed with TAG and deleted in afterAll; seeded rows are never touched.
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
const TAG = `famtest${Date.now().toString(36)}`;

describe.skipIf(!reachable)("family service", () => {
  let db: typeof import("@/lib/db").prisma;
  let svc: typeof import("./service");
  let counter = 0;
  const familyIds: string[] = [];
  const userIds: string[] = [];

  async function makeUser(profilePublic = true) {
    counter += 1;
    const user = await db.user.create({
      data: {
        steamId: `${TAG}-${counter}`,
        handle: `${TAG}-${counter}`,
        displayName: `Tester ${counter}`,
        profilePublic,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function makeFamily(ownerId: string, name = "Família Teste") {
    const family = await svc.createFamily(ownerId, name);
    familyIds.push(family.id);
    return family;
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).prisma;
    svc = await import("./service");
  });

  afterAll(async () => {
    await db.family.deleteMany({ where: { id: { in: familyIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  describe("createFamily", () => {
    it("creates the family with the creator as owner member", async () => {
      const owner = await makeUser();
      const family = await makeFamily(owner.id, "  Os Testadores  ");
      expect(family.name).toBe("Os Testadores");
      expect(family.ownerId).toBe(owner.id);
      const member = await db.familyMember.findUniqueOrThrow({ where: { userId: owner.id } });
      expect(member).toMatchObject({ familyId: family.id, role: "owner" });
    });

    it("rejects names outside 3-40 characters", async () => {
      const owner = await makeUser();
      await expect(svc.createFamily(owner.id, "ab")).rejects.toMatchObject({ code: "invalid_name" });
      await expect(svc.createFamily(owner.id, "x".repeat(41))).rejects.toMatchObject({
        code: "invalid_name",
      });
      expect(await db.familyMember.count({ where: { userId: owner.id } })).toBe(0);
    });

    it("rejects a user who is already in a family", async () => {
      const owner = await makeUser();
      await makeFamily(owner.id);
      await expect(svc.createFamily(owner.id, "Outra família")).rejects.toMatchObject({
        code: "already_in_family",
      });
    });
  });

  describe("createInvite", () => {
    it("creates a 7-day token and URL for a member", async () => {
      const owner = await makeUser();
      const family = await makeFamily(owner.id);
      const before = Date.now();
      const invite = await svc.createInvite(family.id, owner.id);
      expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(invite.url).toBe(`${env.APP_URL}/familia/convite/${invite.token}`);
      const days = (invite.expiresAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
    });

    it("refuses non-members", async () => {
      const owner = await makeUser();
      const stranger = await makeUser();
      const family = await makeFamily(owner.id);
      await expect(svc.createInvite(family.id, stranger.id)).rejects.toMatchObject({
        code: "not_member",
      });
    });
  });

  describe("acceptInvite", () => {
    it("joins the family and consumes the token", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      const { token } = await svc.createInvite(family.id, owner.id);

      expect(await svc.acceptInvite(token, guest.id)).toEqual({ ok: true });
      const member = await db.familyMember.findUniqueOrThrow({ where: { userId: guest.id } });
      expect(member).toMatchObject({ familyId: family.id, role: "member" });
      const invite = await db.familyInvite.findUniqueOrThrow({ where: { token } });
      expect(invite.usedAt).not.toBeNull();
    });

    it("reports not_found for an unknown token", async () => {
      const guest = await makeUser();
      expect(await svc.acceptInvite("nope", guest.id)).toEqual({ ok: false, reason: "not_found" });
    });

    it("reports used when the token was already consumed", async () => {
      const owner = await makeUser();
      const first = await makeUser();
      const second = await makeUser();
      const family = await makeFamily(owner.id);
      const { token } = await svc.createInvite(family.id, owner.id);
      await svc.acceptInvite(token, first.id);
      expect(await svc.acceptInvite(token, second.id)).toEqual({ ok: false, reason: "used" });
      expect(await db.familyMember.count({ where: { userId: second.id } })).toBe(0);
    });

    it("reports expired for a token past its expiry", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      const { token } = await svc.createInvite(family.id, owner.id);
      await db.familyInvite.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await svc.acceptInvite(token, guest.id)).toEqual({ ok: false, reason: "expired" });
      const invite = await db.familyInvite.findUniqueOrThrow({ where: { token } });
      expect(invite.usedAt).toBeNull();
    });

    it("reports already_in_family and keeps the token unused", async () => {
      const owner = await makeUser();
      const otherOwner = await makeUser();
      const family = await makeFamily(owner.id);
      await makeFamily(otherOwner.id, "Outra família");
      const { token } = await svc.createInvite(family.id, owner.id);
      expect(await svc.acceptInvite(token, otherOwner.id)).toEqual({
        ok: false,
        reason: "already_in_family",
      });
      const invite = await db.familyInvite.findUniqueOrThrow({ where: { token } });
      expect(invite.usedAt).toBeNull();
    });

    it("caps the family at 6 members", async () => {
      const owner = await makeUser();
      const family = await makeFamily(owner.id);
      for (let i = 0; i < 5; i++) {
        const guest = await makeUser();
        const { token } = await svc.createInvite(family.id, owner.id);
        expect(await svc.acceptInvite(token, guest.id)).toEqual({ ok: true });
      }
      expect(await db.familyMember.count({ where: { familyId: family.id } })).toBe(6);

      const extra = await makeUser();
      const { token } = await svc.createInvite(family.id, owner.id);
      expect(await svc.acceptInvite(token, extra.id)).toEqual({ ok: false, reason: "full" });
      expect(await db.familyMember.count({ where: { familyId: family.id } })).toBe(6);
    });

    it("lets only one of two concurrent accepts of the same token succeed", async () => {
      const owner = await makeUser();
      const a = await makeUser();
      const b = await makeUser();
      const family = await makeFamily(owner.id);
      const { token } = await svc.createInvite(family.id, owner.id);
      const results = await Promise.all([svc.acceptInvite(token, a.id), svc.acceptInvite(token, b.id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.familyMember.count({ where: { familyId: family.id } })).toBe(2);
    });

    it("never exceeds 6 members under concurrent accepts", async () => {
      const owner = await makeUser();
      const family = await makeFamily(owner.id);
      for (let i = 0; i < 4; i++) {
        const { token } = await svc.createInvite(family.id, owner.id);
        await svc.acceptInvite(token, (await makeUser()).id);
      }
      // 5 members; two different invites race for the last seat.
      const [x, y] = [await makeUser(), await makeUser()];
      const [t1, t2] = [
        (await svc.createInvite(family.id, owner.id)).token,
        (await svc.createInvite(family.id, owner.id)).token,
      ];
      const results = await Promise.all([svc.acceptInvite(t1, x.id), svc.acceptInvite(t2, y.id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "full" });
      expect(await db.familyMember.count({ where: { familyId: family.id } })).toBe(6);
    });
  });

  describe("leaveFamily", () => {
    it("removes a regular member and keeps the owner", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, guest.id);

      expect(await svc.leaveFamily(guest.id)).toEqual({ left: true, familyDeleted: false });
      expect(await db.familyMember.count({ where: { familyId: family.id } })).toBe(1);
      expect((await db.family.findUniqueOrThrow({ where: { id: family.id } })).ownerId).toBe(owner.id);
    });

    it("transfers ownership to the earliest remaining member when the owner leaves", async () => {
      const owner = await makeUser();
      const early = await makeUser();
      const late = await makeUser();
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, early.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, late.id);
      // Make the ordering unambiguous regardless of clock resolution.
      await db.familyMember.update({
        where: { userId: early.id },
        data: { joinedAt: new Date(Date.now() - 2 * 86_400_000) },
      });

      await svc.leaveFamily(owner.id);
      const updated = await db.family.findUniqueOrThrow({ where: { id: family.id } });
      expect(updated.ownerId).toBe(early.id);
      expect((await db.familyMember.findUniqueOrThrow({ where: { userId: early.id } })).role).toBe("owner");
      expect((await db.familyMember.findUniqueOrThrow({ where: { userId: late.id } })).role).toBe("member");
    });

    it("deletes the family when the last member leaves", async () => {
      const owner = await makeUser();
      const family = await makeFamily(owner.id);
      const { token } = await svc.createInvite(family.id, owner.id);
      expect(await svc.leaveFamily(owner.id)).toEqual({ left: true, familyDeleted: true });
      expect(await db.family.findUnique({ where: { id: family.id } })).toBeNull();
      expect(await db.familyInvite.findUnique({ where: { token } })).toBeNull();
    });

    it("is a no-op for someone without a family", async () => {
      const loner = await makeUser();
      expect(await svc.leaveFamily(loner.id)).toEqual({ left: false, familyDeleted: false });
    });
  });

  describe("getFamilyLibrary", () => {
    it("unions the games of two members without duplicating and tracks owners and best progress", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, guest.id);

      const [shared, onlyOwner, onlyGuest] = await db.game.findMany({
        orderBy: { slug: "asc" },
        take: 3,
      });
      await db.userGame.createMany({
        data: [
          { userId: owner.id, gameId: shared.id, playtimeMin: 60, unlockedCount: 1 },
          { userId: guest.id, gameId: shared.id, playtimeMin: 90, unlockedCount: 3 },
          { userId: owner.id, gameId: onlyOwner.id, playtimeMin: 10, unlockedCount: 0 },
          { userId: guest.id, gameId: onlyGuest.id, playtimeMin: 20, unlockedCount: 0 },
        ],
      });

      const library = await svc.getFamilyLibrary(family.id);
      expect(library).toHaveLength(3);
      expect(new Set(library.map((e) => e.game.id)).size).toBe(3);

      const sharedEntry = library.find((e) => e.game.id === shared.id)!;
      expect(sharedEntry.owners.map((o) => o.handle).sort()).toEqual([owner.handle, guest.handle].sort());
      expect(sharedEntry.bestProgress).toMatchObject({ handle: guest.handle, unlocked: 3 });
      expect(sharedEntry.bestProgress.total).toBeGreaterThanOrEqual(shared.achievementCount);
      expect(sharedEntry.bestProgress.pct).toBe(Math.round((3 / sharedEntry.bestProgress.total) * 100));
      expect(sharedEntry.playtimeMin).toBe(150);

      const ownerEntry = library.find((e) => e.game.id === onlyOwner.id)!;
      expect(ownerEntry.owners).toEqual([{ handle: owner.handle, playtimeMin: 10 }]);
      expect(ownerEntry.bestProgress.unlocked).toBe(0);
    });

    it("merges every platform of a member into one entry and sums the members' totals", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, guest.id);
      const [game] = await db.game.findMany({ orderBy: { slug: "desc" }, take: 1 });
      await db.userGame.createMany({
        data: [
          { userId: owner.id, gameId: game.id, platform: "steam", playtimeMin: 60, unlockedCount: 0 },
          { userId: owner.id, gameId: game.id, platform: "psn", playtimeMin: 30, unlockedCount: 0 },
          { userId: guest.id, gameId: game.id, platform: "xbox", playtimeMin: 0, unlockedCount: 0 },
        ],
      });

      const view = await svc.getFamilyLibraryView(family.id);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0].owners).toEqual(
        [
          { handle: owner.handle, playtimeMin: 90 },
          { handle: guest.handle, playtimeMin: 0 },
        ].sort((a, b) => a.handle.localeCompare(b.handle)),
      );
      expect(view.members.map((m) => [m.handle, m.gamesOwned, m.gamesPlayed, m.playtimeMin])).toEqual([
        [owner.handle, 1, 1, 90],
        [guest.handle, 1, 0, 0],
      ]);
    });

    it("ignores members with a private profile", async () => {
      const owner = await makeUser();
      const priv = await makeUser(false);
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, priv.id);
      const game = await db.game.findFirstOrThrow();
      await db.userGame.create({
        data: { userId: priv.id, gameId: game.id, playtimeMin: 5, unlockedCount: 1 },
      });
      expect(await svc.getFamilyLibrary(family.id)).toEqual([]);
    });
  });

  describe("almostThere", () => {
    it("keeps unfinished games where the best member is at 70% or more", () => {
      const entry = (total: number, unlocked: number) => ({
        game: { id: "g", slug: "g", name: "G", coverUrl: null, stub: false },
        owners: [{ handle: "a", playtimeMin: 0 }],
        bestProgress: {
          handle: "a",
          unlocked,
          total,
          pct: total ? Math.round((unlocked / total) * 100) : 0,
        },
        playtimeMin: 0,
      });
      expect(svc.almostThere([entry(10, 7), entry(10, 10), entry(10, 6), entry(0, 0)])).toHaveLength(1);
    });
  });

  describe("getFamilyRanking", () => {
    it("ranks public members by level then points, for general and per skill", async () => {
      const owner = await makeUser();
      const guest = await makeUser();
      const family = await makeFamily(owner.id);
      await svc.acceptInvite((await svc.createInvite(family.id, owner.id)).token, guest.id);
      await db.userStats.createMany({
        data: [
          { userId: owner.id, totalXp: 100, level: 5, vocation: "Recruta" },
          { userId: guest.id, totalXp: 900, level: 9, vocation: "Caçador" },
        ],
      });
      await db.skillProgress.createMany({
        data: [
          { userId: owner.id, skill: "soulslike", level: 7, points: 10 },
          { userId: guest.id, skill: "soulslike", level: 2, points: 5 },
        ],
      });

      const general = await svc.getFamilyRanking(family.id, "geral");
      expect(general.map((r) => r.handle)).toEqual([guest.handle, owner.handle]);
      expect(general[0]).toMatchObject({ level: 9, points: 900, vocation: "Caçador" });

      const soulslike = await svc.getFamilyRanking(family.id, "soulslike");
      expect(soulslike.map((r) => r.handle)).toEqual([owner.handle, guest.handle]);

      const fps = await svc.getFamilyRanking(family.id, "fps");
      expect(fps.every((r) => r.level === 1 && r.points === 0)).toBe(true);
    });
  });
});
