import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { XboxApi, XboxTitle } from "@/lib/integrations/xbox/types";
import { fillXboxConsoles } from "./xbox-consoles";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-e4c` prefix and are removed.
const PREFIX = "test-e4c";

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

const title = (titleId: string, devices: string[]): XboxTitle => ({
  titleId,
  name: titleId,
  currentAchievements: 1,
  totalAchievements: 0,
  currentGamerscore: 10,
  totalGamerscore: 0,
  progress: 0,
  lastPlayed: null,
  devices,
});

function fakeXbox(byXuid: Record<string, XboxTitle[] | "private" | Error>): Pick<XboxApi, "getTitles"> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getTitles(xuid) {
      calls.push(xuid);
      const answer = byXuid[xuid] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

async function list(externalId: string, console: string | null) {
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-${externalId}`, name: externalId, achievementCount: 0, platforms: ["Xbox"] },
  });
  return prisma.trophyList.create({ data: { gameId: game.id, platform: "xbox", externalId: `${PREFIX}-${externalId}`, console, name: externalId, trophyCount: 1 } });
}

async function player(name: string, xuid: string, lists: { id: string }[], linkedAt = new Date()) {
  const user = await prisma.user.create({
    data: {
      handle: `${PREFIX}-${name}`,
      displayName: name,
      linkedAccounts: { create: { platform: "xbox", externalId: xuid, handle: name, verifiedAt: new Date(), linkedAt } },
    },
  });
  if (lists.length > 0) {
    await prisma.userTrophyList.createMany({ data: lists.map((l) => ({ userId: user.id, listId: l.id, unlockedCount: 1 })) });
  }
  return user;
}

const consoles = async () =>
  Object.fromEntries(
    (await prisma.trophyList.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { externalId: true, console: true } })).map((l) => [
      l.externalId.slice(PREFIX.length + 1),
      l.console,
    ]),
  );

describe("fillXboxConsoles", () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("fills the missing consoles from the title history, never rewriting a stored one; a dry run writes nothing", async () => {
    const gta = await list("x360", null);
    const halo = await list("one", null);
    const pc = await list("pc", null);
    await list("kept", "ONE");
    const orphan = await list("orphan", null);
    // The holder of most lists is asked first; one history knows every list: the other is not asked.
    await player("few", "xuid-few", [gta]);
    await player("many", "xuid-many", [gta, halo, pc, orphan]);
    const id = (s: string) => `${PREFIX}-${s}`;
    const history = [
      title(id("x360"), ["Xbox360", "XboxOne", "XboxSeries"]),
      title(id("one"), ["XboxOne", "XboxSeries"]),
      title(id("pc"), ["Win32"]),
      title(id("kept"), ["Xbox360"]),
      title(id("orphan"), ["Mobile"]),
    ];

    const dry = fakeXbox({ "xuid-many": history, "xuid-few": history });
    const preview = await fillXboxConsoles(dry, { dryRun: true });
    expect(preview).toMatchObject({ filled: { "360": 1, ONE: 1, PC: 1 }, unresolved: [id("orphan")], written: false });
    expect(preview.missing).toBeGreaterThanOrEqual(4);
    expect(await consoles()).toEqual({ x360: null, one: null, pc: null, kept: "ONE", orphan: null });

    const xbox = fakeXbox({ "xuid-many": history, "xuid-few": history });
    const report = await fillXboxConsoles(xbox, { dryRun: false });
    expect(report).toMatchObject({ filled: { "360": 1, ONE: 1, PC: 1 }, written: true });
    expect(report.accounts[0]).toMatchObject({ handle: "many", status: "ok", titles: 5 });
    expect(await consoles()).toEqual({ x360: "360", one: "ONE", pc: "PC", kept: "ONE", orphan: null });
    // Devices that say nothing leave the list as it is (the next account is still asked for it).
    expect(xbox.calls.slice(0, 2)).toEqual(["xuid-many", "xuid-few"]);
  });

  it("stops asking once every list is known, and goes on past a private or failing account", async () => {
    const a = await list("a", null);
    const b = await list("b", null);
    await player("private", "xuid-private", [a, b]);
    await player("broken", "xuid-broken", [a]);
    await player("knows", "xuid-knows", []);
    await player("unasked", "xuid-unasked", [], new Date(Date.now() + 60_000));
    const id = (s: string) => `${PREFIX}-${s}`;
    // Only the lists of this test are missing a console in the test database.
    const xbox = fakeXbox({
      "xuid-private": "private",
      "xuid-broken": new Error("Xbox titles failed with HTTP 500"),
      "xuid-knows": [title(id("a"), ["XboxOne"]), title(id("b"), ["PC"])],
    });
    const others = await prisma.trophyList.count({ where: { platform: "xbox", console: null, NOT: { externalId: { startsWith: PREFIX } } } });
    const report = await fillXboxConsoles(xbox, { dryRun: false });
    expect(report.accounts.slice(0, 2).map((x) => [x.handle, x.status])).toEqual([
      ["private", "private"],
      ["broken", "failed"],
    ]);
    expect(report.accounts[1].error).toContain("HTTP 500");
    expect(await consoles()).toEqual({ a: "ONE", b: "PC" });
    if (others === 0) expect(xbox.calls).not.toContain("xuid-unasked");
  });

  it("asks nothing when every Xbox list has a console", async () => {
    await list("done", "360");
    await player("someone", "xuid-someone", []);
    const others = await prisma.trophyList.count({ where: { platform: "xbox", console: null } });
    const xbox = fakeXbox({});
    const report = await fillXboxConsoles(xbox, { dryRun: false });
    if (others === 0) {
      expect(xbox.calls).toEqual([]);
      expect(report).toMatchObject({ missing: 0, written: false, filled: {} });
    }
  });
});
