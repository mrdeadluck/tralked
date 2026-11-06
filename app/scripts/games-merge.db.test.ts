import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { editionPair } from "@/lib/catalog/editions";
import { loadSlugRedirect } from "@/lib/catalog/redirects";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-gmc` prefix and are removed.
const PREFIX = "test-gmc";
const run = promisify(execFile);
let counter = 0;
const next = () => `${PREFIX}-${++counter}`;

async function cleanup() {
  await prisma.gameSlugRedirect.deleteMany({ where: { fromSlug: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(cleanup);

const newGame = (extra: Record<string, unknown> = {}) => {
  const slug = next();
  return prisma.game.create({ data: { slug, name: `Jogo ${slug}`, achievementCount: 0, platforms: [], ...extra } });
};
const ref = (g: { id: string; slug: string }) => ({ id: g.id, slug: g.slug });

async function countRows(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}"`);
    counts[table_name] = Number(row.n);
  }
  return counts;
}

/** A → B → C (listed B→C first), a refused Steam pair, and three edition pairs. */
async function fixtures() {
  const [a, b, c, e] = [await newGame(), await newGame(), await newGame(), await newGame()];
  const s1 = await newGame({ steamAppId: 97500000 + ++counter });
  const s2 = await newGame({ steamAppId: 97500000 + ++counter });
  const user = await prisma.user.create({ data: { handle: next(), displayName: "Teste" } });
  await prisma.userGame.create({ data: { userId: user.id, gameId: a.id, platform: "psn", playtimeMin: 10, unlockedCount: 0 } });
  const approved = {
    merges: [
      { keep: ref(c), drop: ref(b) },
      { keep: ref(s1), drop: ref(s2) },
      { keep: ref(b), drop: ref(a) },
    ],
    editions: [
      { a: ref(a), b: ref(e) }, // A ends on C: C and E are linked
      { a: ref(a), b: ref(c) }, // one game after the joins
      { a: ref(s2), b: ref(e) }, // the refused drop stays a game of its own
    ],
  };
  return { a, b, c, e, s1, s2, user, approved };
}

const script = (args: string[]) =>
  run(process.execPath, ["--import", "tsx", "scripts/games-merge.ts", ...args], { timeout: 120_000 });

describe("pnpm games:merge", () => {
  it("--dry-run opens a read-only session, prints the plan and writes no rows", async () => {
    const { a, b, approved } = await fixtures();
    const dir = mkdtempSync(join(tmpdir(), "games-merge-"));
    const file = join(dir, "aprovado.json");
    writeFileSync(file, JSON.stringify(approved));
    const before = await countRows();
    try {
      const { stdout } = await script(["--file", file, "--dry-run", "--out", dir]);
      expect(stdout).toMatch(/read-only/);
      // The chain runs from its leaf: A→B is printed before B→C.
      expect(stdout.indexOf(`${a.slug} -> ${b.slug}`)).toBeGreaterThan(-1);
      expect(stdout.indexOf(`${a.slug} -> ${b.slug}`)).toBeLessThan(stdout.indexOf(`${b.slug} ->`));
      expect(stdout).toMatch(/refused/);
      expect(readdirSync(dir)).toEqual(["aprovado.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(await countRows()).toEqual(before);
  }, 150_000);

  it("joins a chain onto its last keep, goes past a refused pair and links the editions", async () => {
    const { a, b, c, e, s1, s2, user, approved } = await fixtures();
    const dir = mkdtempSync(join(tmpdir(), "games-merge-"));
    const file = join(dir, "aprovado.json");
    writeFileSync(file, JSON.stringify(approved));
    try {
      const { stdout } = await script(["--file", file, "--skip-revalidate", "--out", dir]);
      expect(stdout).toMatch(/2 joined, 0 already joined, 1 refused; 2 edition pairs linked, 1 became one game/);
      expect(await prisma.game.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
      expect(await loadSlugRedirect(a.slug)).toBe(c.slug);
      expect(await loadSlugRedirect(b.slug)).toBe(c.slug);
      expect(await prisma.userGame.findMany({ where: { userId: user.id }, select: { gameId: true } })).toEqual([{ gameId: c.id }]);
      expect(await prisma.game.count({ where: { id: { in: [s1.id, s2.id] } } })).toBe(2);
      expect(await prisma.gameEdition.findUnique({ where: { gameId_otherId: editionPair(c.id, e.id) } })).not.toBeNull();
      expect(await prisma.gameEdition.findUnique({ where: { gameId_otherId: editionPair(s2.id, e.id) } })).not.toBeNull();
      const records = readdirSync(dir).filter((f) => f.startsWith("games-merge-"));
      expect(records).toHaveLength(1);
      const first = JSON.parse(readFileSync(join(dir, records[0]), "utf8"));
      expect(first.merges).toHaveLength(3);
      // The player was in both joins of the chain and is recomputed once, after the last one.
      expect([first.recomputed, first.pendingRecompute]).toEqual([[user.id], []]);
      expect(await prisma.userStats.findUnique({ where: { userId: user.id } })).not.toBeNull();

      // A run that stopped after its joins left a player to recompute: the next run does it.
      const stranded = await prisma.user.create({ data: { handle: next(), displayName: "Teste" } });
      const stopped = join(dir, "games-merge-2026-11-06T00-00-00-000Z.json");
      writeFileSync(stopped, JSON.stringify({ merges: [], pendingRecompute: [stranded.id], recomputed: [] }));
      const again = await script(["--file", file, "--skip-revalidate", "--out", dir]);
      expect(again.stdout).toMatch(/0 joined, 2 already joined, 1 refused/);
      expect(await prisma.userStats.findUnique({ where: { userId: stranded.id } })).not.toBeNull();
      expect(JSON.parse(readFileSync(stopped, "utf8")).pendingRecompute).toEqual([]);
      const second = readdirSync(dir).filter((f) => f.startsWith("games-merge-") && f !== records[0] && join(dir, f) !== stopped);
      const record = JSON.parse(readFileSync(join(dir, second[0]), "utf8"));
      expect(record.recomputed).toEqual([stranded.id]);
      // The pairs already joined still have their old, kept and redirect-target slugs expired.
      expect(record.slugs).toEqual([a.slug, b.slug, c.slug, e.slug, s2.slug].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
