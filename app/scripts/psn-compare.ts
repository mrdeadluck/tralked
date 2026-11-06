/**
 * Sony x Tralked, per user with an active PSN connection: trophy lists, earned trophies and
 * earned platinums as Sony lists them (trophyTitles of the account) against what Tralked holds
 * (lists with progress, PSN unlocks, platinum trophies unlocked). Read-only on the database.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm psn:compare [--user diguzz]
 *
 * PSN_NPSSO is read from C:\projetos\Nova pasta\.env.chaves (never printed).
 */
import { parseArgs } from "node:util";
import { readKeys } from "./lib/keys";
import { requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { user: { type: "string" } } });

requireDatabaseUrl();
const npsso = readKeys().get("PSN_NPSSO");
if (!npsso) {
  console.error("No PSN_NPSSO in C:\\projetos\\Nova pasta\\.env.chaves.");
  process.exit(2);
}

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { createPsnClient } = await import("@/lib/integrations/psn/client");
const { describeError } = await import("@/lib/worker/errors");

const psn = createPsnClient({ npsso });
const pad = (value: string | number, width: number) => String(value).padStart(width);
const diff = (sony: number, tralked: number) => (sony === tralked ? "=" : `${tralked - sony > 0 ? "+" : ""}${tralked - sony}`);

try {
  const accounts = await prisma.linkedAccount.findMany({
    where: { platform: "psn", linkedAt: { not: null }, ...(values.user && { user: { handle: values.user } }) },
    select: { userId: true, externalId: true, handle: true, user: { select: { handle: true } } },
    orderBy: { user: { handle: "asc" } },
  });
  if (accounts.length === 0) {
    console.error(values.user ? `No active PSN connection for ${values.user}.` : "No active PSN connection.");
    process.exitCode = 1;
  }
  for (const account of accounts) {
    const who = `${account.user.handle} (PSN ${account.handle})`;
    let titles;
    try {
      titles = await psn.getTitles(account.externalId);
    } catch (error) {
      console.error(`${who}: Sony did not answer: ${describeError(error)}`);
      process.exitCode = 1;
      continue;
    }
    if (titles === "private") {
      console.log(`${who}: the trophy list is private to the service account.`);
      continue;
    }
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
    const sony = {
      lists: titles.length,
      played: titles.filter((t) => sum(t.earnedCounts) > 0).length,
      earned: titles.reduce((total, t) => total + sum(t.earnedCounts), 0),
      platinums: titles.reduce((total, t) => total + (t.earnedCounts.platinum ?? 0), 0),
    };
    const [lists, unlocks, platinums] = await Promise.all([
      prisma.userTrophyList.count({ where: { userId: account.userId, list: { platform: "psn" } } }),
      prisma.userAchievement.count({ where: { userId: account.userId, achievement: { platform: "psn" } } }),
      prisma.userAchievement.count({
        where: { userId: account.userId, achievement: { platform: "psn", trophyTier: "platinum" } },
      }),
    ]);
    console.log(`\n${who}`);
    console.log(`  ${"".padEnd(26)}${pad("Sony", 8)}${pad("Tralked", 9)}${pad("diff", 8)}`);
    console.log(`  ${"lists with trophies earned".padEnd(26)}${pad(sony.played, 8)}${pad(lists, 9)}${pad(diff(sony.played, lists), 8)}`);
    console.log(`  ${"earned trophies".padEnd(26)}${pad(sony.earned, 8)}${pad(unlocks, 9)}${pad(diff(sony.earned, unlocks), 8)}`);
    console.log(`  ${"earned platinums".padEnd(26)}${pad(sony.platinums, 8)}${pad(platinums, 9)}${pad(diff(sony.platinums, platinums), 8)}`);
    console.log(`  (Sony lists in all, earned or not: ${sony.lists})`);
  }
} catch (error) {
  console.error("PSN comparison failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
