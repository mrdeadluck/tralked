import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const { updatePlayerSetupAction } = await import("./actions");
const { getPlayerSetup } = await import("@/lib/setup/queries");
const { exportUserData } = await import("@/lib/accounts/export");

const PREFIX = "setup-test-";
let me: { id: string };
let other: { id: string };

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  me = await prisma.user.create({ data: { handle: `${PREFIX}eu`, displayName: "Eu" } });
  other = await prisma.user.create({ data: { handle: `${PREFIX}outro`, displayName: "Outro" } });
});

afterAll(cleanup);

beforeEach(async () => {
  getSessionUser.mockReset();
  getSessionUser.mockResolvedValue({ id: me.id, handle: `${PREFIX}eu` });
  await prisma.playerSetup.deleteMany({ where: { userId: { in: [me.id, other.id] } } });
});

describe("updatePlayerSetupAction", () => {
  it("needs a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await updatePlayerSetupAction({ platforms: ["ps5"], pc: null })).toMatchObject({ ok: false });
    expect(await prisma.playerSetup.count({ where: { userId: me.id } })).toBe(0);
  });

  it("saves the logged-in player's platforms and cleaned spec sheet, and returns what was stored", async () => {
    const result = await updatePlayerSetupAction({
      platforms: ["switch", "ps5", "pc"],
      pc: { cpu: "  Ryzen 7 7800X3D ", gpu: "RTX 4070\nSuper", ram: "", mouse: "   " },
    });
    expect(result).toEqual({
      ok: true,
      setup: { platforms: ["ps5", "switch", "pc"], pc: { cpu: "Ryzen 7 7800X3D", gpu: "RTX 4070 Super" } },
    });
    expect(await getPlayerSetup(me.id)).toEqual({
      platforms: ["ps5", "switch", "pc"],
      pc: { cpu: "Ryzen 7 7800X3D", gpu: "RTX 4070 Super" },
    });
    expect(await getPlayerSetup(other.id)).toEqual({ platforms: [], pc: null });
    // The LGPD export carries it too.
    expect((await exportUserData(me.id))?.setup).toMatchObject({ platforms: ["ps5", "switch", "pc"], pc: { cpu: "Ryzen 7 7800X3D" } });
  });

  it("updates in place, clears the spec sheet, and deletes the row when everything is empty", async () => {
    await updatePlayerSetupAction({ platforms: ["ps2"], pc: { cpu: "Pentium 4" } });
    expect(await updatePlayerSetupAction({ platforms: ["ps2", "n64"], pc: { cpu: "" } })).toMatchObject({ ok: true });
    const row = await prisma.playerSetup.findUnique({ where: { userId: me.id } });
    expect(row).toMatchObject({ platforms: ["ps2", "n64"], pc: null });

    expect(await updatePlayerSetupAction({ platforms: [], pc: null })).toEqual({ ok: true, setup: { platforms: [], pc: null } });
    expect(await prisma.playerSetup.count({ where: { userId: me.id } })).toBe(0);
  });

  it("refuses invalid input without saving, pointing at the field", async () => {
    const results = await Promise.all([
      updatePlayerSetupAction({ platforms: ["ps9"], pc: null }),
      updatePlayerSetupAction({ platforms: [], pc: { gpu: "<script>alert(1)</script>" } }),
      updatePlayerSetupAction({ platforms: [], pc: { headset: "a".repeat(81) } }),
      // Someone else's setup cannot be targeted: unknown keys are refused.
      updatePlayerSetupAction({ platforms: ["ps5"], pc: null, userId: other.id }),
      updatePlayerSetupAction("nope"),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(results[0]).toMatchObject({ field: "platforms" });
    expect(results[1]).toMatchObject({ field: "pc.gpu", error: expect.stringMatching(/HTML/) });
    expect(results[2]).toMatchObject({ field: "pc.headset", error: expect.stringMatching(/80/) });
    expect(await prisma.playerSetup.count({ where: { userId: { in: [me.id, other.id] } } })).toBe(0);
  });

  it("the setup goes away with the account", async () => {
    const temp = await prisma.user.create({ data: { handle: `${PREFIX}temp`, displayName: "Temp" } });
    getSessionUser.mockResolvedValue({ id: temp.id, handle: temp.handle });
    await updatePlayerSetupAction({ platforms: ["pc"], pc: { cpu: "i5" } });
    await prisma.user.delete({ where: { id: temp.id } });
    expect(await prisma.playerSetup.count({ where: { userId: temp.id } })).toBe(0);
  });
});

describe("getPlayerSetup", () => {
  it("drops platform ids that left the catalog and invalid stored spec values", async () => {
    await prisma.playerSetup.create({
      data: { userId: me.id, platforms: ["ouya", "switch", "ps1"], pc: { cpu: "i7", gpu: 3, chair: "x" } },
    });
    expect(await getPlayerSetup(me.id)).toEqual({ platforms: ["ps1", "switch"], pc: { cpu: "i7" } });
  });
});
