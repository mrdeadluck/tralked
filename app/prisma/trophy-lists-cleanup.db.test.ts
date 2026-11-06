import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-tlc` prefix and are removed;
// the guard test runs in a transaction that is always rolled back.
const PREFIX = "test-tlc";
const MIGRATION = fileURLToPath(new URL("./migrations/20261113090000_trophy_lists_cleanup/migration.sql", import.meta.url));
let gameId: string;

/** The migration's opening guard: the `DO $$ … $$;` block (one statement, as Prisma runs it). */
function guardOf(sql: string): string {
  const block = sql.match(/DO \$\$[\s\S]*?\$\$;/);
  if (!block) throw new Error("The cleanup migration has no DO $$ … $$; guard");
  return block[0];
}

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  gameId = (await prisma.game.create({ data: { slug: `${PREFIX}-game`, name: "Cleanup", achievementCount: 0, platforms: ["PS4"] } })).id;
});
afterAll(cleanup);

describe("trophy lists cleanup (phase d)", () => {
  it("an Achievement cannot be stored without a list", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Achievement" (id, "gameId", platform, "apiName", name)
        VALUES (${`${PREFIX}-no-list`}, ${gameId}, 'psn', '1', 'Sem lista')`,
    ).rejects.toThrow(/listId/);
  });

  it("the cleanup migration refuses to run while an Achievement has no list", async () => {
    const guard = guardOf(readFileSync(MIGRATION, "utf8"));
    // As a database not cleaned yet: the column nullable and one row without a list.
    const run = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "Achievement" ALTER COLUMN "listId" DROP NOT NULL`);
      await tx.$executeRaw`
        INSERT INTO "Achievement" (id, "gameId", platform, "apiName", name)
        VALUES (${`${PREFIX}-no-list`}, ${gameId}, 'psn', '1', 'Sem lista')`;
      await tx.$executeRawUnsafe(guard);
    });
    await expect(run).rejects.toThrow(/1 Achievement row\(s\) without a list/);
    // Rolled back: the column is still required and the row is gone.
    const [column] = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Achievement' AND column_name = 'listId'`;
    expect(column.is_nullable).toBe("NO");
    expect(await prisma.achievement.count({ where: { gameId } })).toBe(0);
  });

  it("the guard lets a database whose every Achievement has a list through", async () => {
    await expect(prisma.$executeRawUnsafe(guardOf(readFileSync(MIGRATION, "utf8")))).resolves.toBe(0);
  });
});
