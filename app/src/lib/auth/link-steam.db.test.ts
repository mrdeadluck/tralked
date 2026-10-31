import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Real Prisma against the test database (the Steam fixture answers the player summary).
const { prisma } = await import("@/lib/db");
const { linkSteamToUser } = await import("./link-steam");

const MARK = "t11-link";
const STEAM_A = "76561190000011001";
const STEAM_B = "76561190000011002";

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}

const googleUser = (suffix: string) =>
  prisma.user.create({ data: { handle: `${MARK}-${suffix}`, displayName: "Leitora", googleSub: `${MARK}-sub-${suffix}` } });

beforeEach(cleanup);
afterAll(cleanup);

describe("linkSteamToUser (database)", () => {
  it("attaches Steam to a Google-only account: User.steamId + verified LinkedAccount, no second user", async () => {
    const user = await googleUser("a");
    const before = await prisma.user.count();
    const result = await linkSteamToUser(user.id, STEAM_A);
    expect(result).toMatchObject({ ok: true, user: { id: user.id, steamId: STEAM_A, googleSub: `${MARK}-sub-a` } });
    expect(await prisma.user.count()).toBe(before);
    const steam = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "steam" } },
    });
    expect(steam.externalId).toBe(STEAM_A);
    expect(steam.verifiedAt).not.toBeNull();
    // Linking the same Steam again is a no-op success.
    expect(await linkSteamToUser(user.id, STEAM_A)).toMatchObject({ ok: true });
  });

  it("refuses a SteamID that is another user's User.steamId", async () => {
    await prisma.user.create({ data: { handle: `${MARK}-dono`, displayName: "Dono", steamId: STEAM_A } });
    const user = await googleUser("b");
    expect(await linkSteamToUser(user.id, STEAM_A)).toEqual({ ok: false, reason: "in_use" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBeNull();
  });

  it("refuses a SteamID verified on another user's LinkedAccount", async () => {
    const other = await googleUser("c");
    await prisma.linkedAccount.create({
      data: { userId: other.id, platform: "steam", externalId: STEAM_A, handle: "x", verifiedAt: new Date() },
    });
    const user = await googleUser("d");
    expect(await linkSteamToUser(user.id, STEAM_A)).toEqual({ ok: false, reason: "in_use" });
  });

  it("drops someone else's unverified claim on the SteamID (OpenID is the proof)", async () => {
    const squatter = await googleUser("e");
    await prisma.linkedAccount.create({
      data: { userId: squatter.id, platform: "steam", externalId: STEAM_A, handle: "x", verifiedAt: null },
    });
    const user = await googleUser("f");
    expect(await linkSteamToUser(user.id, STEAM_A)).toMatchObject({ ok: true });
    expect(await prisma.linkedAccount.count({ where: { userId: squatter.id } })).toBe(0);
  });

  it("refuses a second, different Steam account on a user that already has one", async () => {
    const user = await googleUser("g");
    expect(await linkSteamToUser(user.id, STEAM_A)).toMatchObject({ ok: true });
    expect(await linkSteamToUser(user.id, STEAM_B)).toEqual({ ok: false, reason: "has_other" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBe(STEAM_A);
  });
});
