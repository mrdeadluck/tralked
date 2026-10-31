import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SteamPublicProfile } from "@/lib/integrations/steam/profile-lookup";

// Steam's public profiles as the connection check reads them (no network in tests).
const steam = vi.hoisted(() => ({ profiles: new Map<string, SteamPublicProfile>() }));
vi.mock("@/lib/integrations/steam/profile-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/steam/profile-lookup")>();
  return {
    ...actual,
    getSteamProfileLookup: () => ({
      find: async (ref: { kind: "id"; steamId: string } | { kind: "vanity"; vanity: string }) =>
        steam.profiles.get(ref.kind === "id" ? ref.steamId : ref.vanity.toLowerCase()) ?? null,
    }),
  };
});

const { prisma } = await import("@/lib/db");
const { startLink, unlink } = await import("./link");
const { confirmSteamLink } = await import("./steam-link");

const MARK = "tsteam_";
const T0 = new Date("2026-10-31T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const STEAM_NEW = "76561198000099001";
const STEAM_OLD = "76561198000099002";
const CODE = "TRK-AB3CD9";

function profile(steamId: string, vanity: string, summary: string, profilePublic = true) {
  const p = { steamId, personaName: `Persona ${vanity}`, summary, profilePublic };
  steam.profiles.set(steamId, p);
  steam.profiles.set(vanity.toLowerCase(), p);
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
}
beforeEach(async () => {
  steam.profiles.clear();
  await cleanup();
});
afterAll(cleanup);

let n = 0;
const newAccount = (data: { passwordHash?: string | null; googleSub?: string; steamId?: string; email?: string } = {}) =>
  prisma.user.create({
    data: {
      handle: `${MARK}${++n}`,
      displayName: `Teste ${n}`,
      email: data.email ?? `${MARK}${n}@steam.test`,
      passwordHash: "passwordHash" in data ? data.passwordHash : "scrypt$fake",
      googleSub: data.googleSub,
      steamId: data.steamId,
    },
  });

/** Starts the link and simulates the user pasting the code in the profile "Resumo". */
async function startWithCode(userId: string, input: string) {
  const started = await startLink(userId, "steam", input, T0);
  expect(started.ok).toBe(true);
  await prisma.linkedAccount.update({
    where: { userId_platform: { userId, platform: "steam" } },
    data: { verifyCode: CODE },
  });
}

describe("confirmSteamLink (database)", () => {
  it("links the Steam whose Resumo shows the code: User.steamId + verified LinkedAccount", async () => {
    profile(STEAM_NEW, "novo-perfil", `Oi! ${CODE.toLowerCase()}`);
    const user = await newAccount();
    await startWithCode(user.id, "https://steamcommunity.com/id/novo-perfil/");

    expect(await confirmSteamLink(user.id, later(1000))).toEqual({ ok: true, handle: "Persona novo-perfil", claimed: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBe(STEAM_NEW);
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: user.id, platform: "steam" } } }),
    ).toMatchObject({ externalId: STEAM_NEW, handle: "Persona novo-perfil", verifyCode: null, verifiedAt: later(1000) });
  });

  it("refuses a missing code, an expired code and a private profile", async () => {
    profile(STEAM_NEW, "novo-perfil", "sem código aqui");
    const user = await newAccount();
    await startWithCode(user.id, STEAM_NEW);
    expect(await confirmSteamLink(user.id, later(1000))).toEqual({ ok: false, reason: "code_missing" });

    await prisma.linkedAccount.update({
      where: { userId_platform: { userId: user.id, platform: "steam" } },
      data: { verifyExpiresAt: later(-1) },
    });
    expect(await confirmSteamLink(user.id, later(60_000))).toEqual({ ok: false, reason: "expired" });

    profile(STEAM_OLD, "fechado", "", false);
    const other = await newAccount();
    await startWithCode(other.id, "fechado");
    expect(await confirmSteamLink(other.id, later(1000))).toEqual({ ok: false, reason: "private" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).steamId).toBeNull();
  });

  it("refuses a Steam that already belongs to an account with credentials", async () => {
    profile(STEAM_OLD, "dono", CODE);
    await newAccount({ steamId: STEAM_OLD }); // e-mail + password
    await newAccount({ steamId: undefined, passwordHash: null, googleSub: `${MARK}g` }).then((g) =>
      prisma.linkedAccount.create({
        data: { userId: g.id, platform: "steam", externalId: STEAM_NEW, handle: "G", verifiedAt: T0 },
      }),
    );
    profile(STEAM_NEW, "google", CODE);

    const user = await newAccount();
    await startWithCode(user.id, "dono");
    expect(await confirmSteamLink(user.id, later(1000))).toEqual({ ok: false, reason: "taken" });

    const another = await newAccount();
    await startWithCode(another.id, STEAM_NEW);
    expect(await confirmSteamLink(another.id, later(1000))).toEqual({ ok: false, reason: "taken" });
  });

  it("recovers an account of the old Steam login: credentials move to it, the new account goes away", async () => {
    profile(STEAM_OLD, "veterano", CODE);
    const legacy = await prisma.user.create({
      data: { handle: `${MARK}veterano`, displayName: "Veterano", role: "editor", steamId: STEAM_OLD },
    });
    await prisma.linkedAccount.create({
      data: { userId: legacy.id, platform: "steam", externalId: STEAM_OLD, handle: "Veterano", verifiedAt: T0 },
    });
    await prisma.xpLedgerEntry.create({ data: { userId: legacy.id, source: "seed", sourceKey: "x", xp: 500, skills: [] } });

    const fresh = await newAccount({ email: `${MARK}novo@steam.test`, passwordHash: "scrypt$novo" });
    await startWithCode(fresh.id, "veterano");

    expect(await confirmSteamLink(fresh.id, later(1000))).toEqual({
      ok: true,
      handle: "Persona veterano",
      claimed: { userId: legacy.id, handle: `${MARK}veterano` },
    });
    expect(await prisma.user.findUnique({ where: { id: fresh.id } })).toBeNull();
    const recovered = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(recovered).toMatchObject({
      email: `${MARK}novo@steam.test`,
      passwordHash: "scrypt$novo",
      role: "editor",
      steamId: STEAM_OLD,
      handle: `${MARK}veterano`,
    });
    expect(await prisma.xpLedgerEntry.count({ where: { userId: legacy.id } })).toBe(1);
  });

  it("verifies the Steam row of a recovered account that was imported unverified", async () => {
    profile(STEAM_OLD, "importado", CODE);
    const legacy = await prisma.user.create({ data: { handle: `${MARK}importado`, displayName: "Importado", steamId: STEAM_OLD } });
    await prisma.linkedAccount.create({
      data: { userId: legacy.id, platform: "steam", externalId: STEAM_OLD, handle: "Importado" },
    });
    const fresh = await newAccount();
    await startWithCode(fresh.id, STEAM_OLD);
    expect(await confirmSteamLink(fresh.id, later(1000))).toMatchObject({ ok: true, claimed: { userId: legacy.id } });
    expect(
      await prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId: legacy.id, platform: "steam" } } }),
    ).toMatchObject({ externalId: STEAM_OLD, verifiedAt: later(1000) });
  });

  it("does not merge into the old account when the new one already has activity", async () => {
    profile(STEAM_OLD, "veterano", CODE);
    const legacy = await prisma.user.create({ data: { handle: `${MARK}veterano2`, displayName: "Veterano", steamId: STEAM_OLD } });
    const busy = await newAccount();
    await prisma.xpLedgerEntry.create({ data: { userId: busy.id, source: "mission", sourceKey: "m1", xp: 10, skills: [] } });
    await startWithCode(busy.id, "veterano");
    expect(await confirmSteamLink(busy.id, later(1000))).toEqual({ ok: false, reason: "has_activity" });
    expect(await prisma.user.findUnique({ where: { id: busy.id } })).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash).toBeNull();
  });
});

describe("unlink Steam (database)", () => {
  it("clears User.steamId and voids the Steam XP (never deleting the ledger)", async () => {
    profile(STEAM_NEW, "novo-perfil", CODE);
    const user = await newAccount();
    await startWithCode(user.id, "novo-perfil");
    expect((await confirmSteamLink(user.id, later(1000))).ok).toBe(true);
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: "a1", xp: 100, skills: [], platform: "steam" },
    });

    expect(await unlink(user.id, "steam", later(2000))).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).steamId).toBeNull();
    const entry = await prisma.xpLedgerEntry.findFirstOrThrow({ where: { userId: user.id, sourceKey: "a1" } });
    expect(entry.voidedAt).toEqual(later(2000));
    // The Steam account is free again: someone else who proves it can link it.
    const other = await newAccount();
    await startWithCode(other.id, "novo-perfil");
    expect((await confirmSteamLink(other.id, later(60_000))).ok).toBe(true);
  });
});
