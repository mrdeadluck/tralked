import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { SampleName } from "../../prisma/seed-data/sample-names";

// Needs Postgres up (see src/lib/db.test.ts); skipped when unreachable.
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

// Own names and SteamIDs, so the seeded players are never touched by this test.
const steamIdOf = (index: number) => `rn-test-steam-${index}`;
const NAMES: SampleName[] = [
  { kind: "player", index: 0, previous: "rnt_Velho_A", handle: "rnt_Novo_A", displayName: "Novo A" },
  { kind: "player", index: 1, previous: "rnt_Velho_B", handle: "rnt_Novo_B", displayName: "Novo B" },
  { kind: "player", index: 2, previous: "rnt_Velho_C", handle: "rnt_Novo_C", displayName: "Novo C" },
  { kind: "author", previous: "rnt_Byline", handle: "rnt_Byline_Nova", displayName: "Byline Nova" },
  { kind: "player", index: 3, previous: "diguzz", handle: "rnt_Nunca", displayName: "Nunca" },
];

describe.skipIf(!reachable)("renameSampleUsers", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let renameSampleUsers: typeof import("./rename-sample-users").renameSampleUsers;

  const cleanup = async () => {
    await prisma.notification.deleteMany({ where: { user: { handle: { startsWith: "rnt_" } } } });
    await prisma.author.deleteMany({ where: { handle: { startsWith: "rnt_" } } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: "rnt_" } } });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ renameSampleUsers } = await import("./rename-sample-users"));
    await cleanup();
    // A: the seeded player (seed SteamID), with a byline, a Steam account and a notification about them.
    const a = await prisma.user.create({ data: { handle: "rnt_Velho_A", displayName: "rnt_Velho_A", steamId: steamIdOf(0) } });
    await prisma.author.create({ data: { handle: "rnt_Velho_A", userId: a.id } });
    await prisma.linkedAccount.create({ data: { userId: a.id, platform: "steam", externalId: steamIdOf(0), handle: "rnt_Velho_A" } });
    // B: someone else using the old name (another SteamID): never renamed.
    await prisma.user.create({ data: { handle: "rnt_Velho_B", displayName: "rnt_Velho_B", steamId: "rn-test-other" } });
    // C: the seeded player, but its new handle is already someone else's: left alone.
    await prisma.user.create({ data: { handle: "rnt_Velho_C", displayName: "rnt_Velho_C", steamId: steamIdOf(2) } });
    await prisma.user.create({ data: { handle: "rnt_Novo_C", displayName: "Outra pessoa" } });
    // A byline without an account, and a notification to a real-looking user mentioning A.
    await prisma.author.create({ data: { handle: "rnt_Byline" } });
    const reader = await prisma.user.create({ data: { handle: "rnt_leitor", displayName: "Leitor" } });
    await prisma.notification.createMany({
      data: [
        { userId: reader.id, kind: "comment_reply", title: "@rnt_Velho_A comentou na sua foto" },
        { userId: reader.id, kind: "photo_like", title: "rnt_Velho_A curtiu sua foto" },
        { userId: reader.id, kind: "system", title: "rnt_Velho_Abc curtiu sua foto" },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
  });

  it("dry run reports without writing", async () => {
    const { changes } = await renameSampleUsers(prisma, NAMES, { dryRun: true, steamIdOf });
    expect(changes.map((c) => `${c.model}.${c.field}:${c.to}`)).toEqual(
      expect.arrayContaining(["User.handle:rnt_Novo_A", "User.displayName:Novo A", "Author.handle:rnt_Byline_Nova"]),
    );
    expect(await prisma.user.findUnique({ where: { handle: "rnt_Velho_A" } })).not.toBeNull();
  });

  it("renames only the seed's rows, never protected or foreign accounts, and is idempotent", async () => {
    const { skipped } = await renameSampleUsers(prisma, NAMES, { dryRun: false, steamIdOf });
    const a = await prisma.user.findUniqueOrThrow({ where: { handle: "rnt_Novo_A" }, include: { author: true, linkedAccounts: true } });
    expect(a.displayName).toBe("Novo A");
    expect(a.author?.handle).toBe("rnt_Novo_A");
    expect(a.linkedAccounts[0].handle).toBe("Novo A");
    expect(await prisma.author.findUnique({ where: { handle: "rnt_Byline_Nova" } })).not.toBeNull();

    // Not the seed's player, and a player whose new handle is taken: untouched.
    expect(await prisma.user.findUnique({ where: { handle: "rnt_Velho_B" } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { handle: "rnt_Velho_C" } })).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { handle: "rnt_Novo_C" } })).displayName).toBe("Outra pessoa");
    expect(skipped.some((s) => s.startsWith("diguzz"))).toBe(true);

    const titles = (await prisma.notification.findMany({ where: { user: { handle: "rnt_leitor" } }, orderBy: { title: "asc" } })).map((n) => n.title);
    expect(titles).toEqual(["@rnt_Novo_A comentou na sua foto", "rnt_Novo_A curtiu sua foto", "rnt_Velho_Abc curtiu sua foto"]);

    const again = await renameSampleUsers(prisma, NAMES, { dryRun: false, steamIdOf });
    expect(again.changes).toEqual([]);
  });
});
