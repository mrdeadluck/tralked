import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findDuplicateCandidates, renderMarkdown, type DuplicateGroup } from "./duplicates";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-dup` prefix and are removed.
const PREFIX = "test-dup";
const run = promisify(execFile);

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function mine(): Promise<DuplicateGroup[]> {
  return (await findDuplicateCandidates()).filter((g) => g.keep.slug.startsWith(PREFIX) || g.drop.slug.startsWith(PREFIX));
}

const game = (slug: string, name: string, extra: Record<string, unknown> = {}) =>
  prisma.game.create({ data: { slug: `${PREFIX}-${slug}`, name, achievementCount: 0, platforms: ["PLAYSTATION"], ...extra } });

const guideOf = (gameId: string) =>
  prisma.guide.create({
    data: {
      gameId,
      status: "draft",
      version: "1",
      difficulty: 3,
      hoursMin: 1,
      hoursMax: 2,
      playthroughs: "1",
      missables: 0,
      online: 0,
      overview: [],
      warnings: [],
    },
  });

beforeAll(async () => {
  await cleanup();
  // Ghost of Yōtei and its store edition (the older row is the plain game).
  await game("yotei", "Ghost of Yōtei");
  const dd = await game("yotei-dd", "Ghost of Yotei: Digital Deluxe Edition");
  // A catalog list nobody holds sits on the edition: it moves too.
  await prisma.trophyList.create({
    data: { gameId: dd.id, platform: "psn", externalId: `${PREFIX}-NPWR1_00`, console: "PS5", name: "Ghost of Yotei", trophyCount: 10 },
  });

  await game("steam-a", "Test Dup Steam Twin", { steamAppId: 990001 });
  await game("steam-b", "Test Dup Steam Twin", { steamAppId: 990002 });

  await game("strand", "Test Dup Strand");
  await game("strand-dc", "Test Dup Strand Director's Cut");

  const ga = await game("guide-a", "Test Dup Guided");
  const gb = await game("guide-b", "Test Dup Guided Complete Edition");
  await guideOf(ga.id);
  await guideOf(gb.id);

  // Keep order: the Steam game wins over an older plain game.
  await game("plain-old", "Test Dup Ranked");
  await game("plain-steam", "Test Dup Ranked Definitive Edition", { steamAppId: 990003 });

  // A PSN list that sits on one game while its name maps to another (the phase-e match check).
  const holder = await game("holder", "Test Dup Holder Collection");
  await game("target", "Test Dup Holder");
  await prisma.trophyList.create({
    data: { gameId: holder.id, platform: "psn", externalId: `${PREFIX}-NPWR2_00`, console: "PS4", name: "Test Dup Holder", trophyCount: 5 },
  });
});
afterAll(cleanup);

describe("duplicate candidates", () => {
  it("ghost-of-yotei and its digital deluxe edition are one group", async () => {
    const groups = (await mine()).filter((g) => g.keep.slug.includes("yotei") || g.drop.slug.includes("yotei"));
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g.verdict).toBe("junta");
    expect(g.keep.slug).toBe(`${PREFIX}-yotei`);
    expect(g.drop.slug).toBe(`${PREFIX}-yotei-dd`);
    expect(g.reasons.length).toBeGreaterThan(0);
    // The catalog list nobody holds moves with the game.
    expect(g.moves.catalogLists).toBe(1);
    expect(g.moves.trophyLists).toBe(1);
  });

  it("two steam games are never joined", async () => {
    const [g] = (await mine()).filter((x) => x.keep.slug.includes("steam-") || x.drop.slug.includes("steam-"));
    expect(g.verdict).toBe("nao-junta-steam");
    expect(g.keep.steamAppId).not.toBeNull();
    expect(g.drop.steamAppId).not.toBeNull();
  });

  it("Death Stranding and Director's Cut are other editions", async () => {
    const [g] = (await mine()).filter((x) => x.keep.slug.includes("strand") || x.drop.slug.includes("strand"));
    expect(g.verdict).toBe("outra-edicao");
    expect(g.keep.slug).toBe(`${PREFIX}-strand`);
  });

  it("two games with a guide are never joined", async () => {
    const [g] = (await mine()).filter((x) => x.keep.slug.includes("guide-"));
    expect(g.verdict).toBe("nao-junta-guia");
  });

  it("the Steam game is the one that stays", async () => {
    const [g] = (await mine()).filter((x) => x.keep.slug.includes("plain-") || x.drop.slug.includes("plain-"));
    expect(g.keep.slug).toBe(`${PREFIX}-plain-steam`);
    expect(g.drop.slug).toBe(`${PREFIX}-plain-old`);
    expect(g.verdict).toBe("outra-edicao"); // Definitive
  });

  it("a PSN list sitting on a game whose name maps to another is surfaced", async () => {
    const groups = (await mine()).filter((x) => x.keep.slug.includes("holder") || x.drop.slug.includes("holder") || x.keep.slug.includes("target") || x.drop.slug.includes("target"));
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons.join(" ")).toMatch(/NPWR2_00/);
  });

  it("the markdown has one table per verdict with a checkbox per row", async () => {
    const md = renderMarkdown(await mine(), "2026-11-06");
    expect(md).toContain("[ ] juntar");
    expect(md).toContain(`${PREFIX}-yotei-dd`);
    expect(md).toMatch(/^## /m);
  });

  it("the script writes no rows", async () => {
    const countRows = async () => {
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
      const counts: Record<string, number> = {};
      for (const { table_name } of tables) {
        const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}"`);
        counts[table_name] = Number(row.n);
      }
      return counts;
    };
    const before = await countRows();
    const out = mkdtempSync(join(tmpdir(), "dup-report-"));
    try {
      await run(process.execPath, ["--import", "tsx", "scripts/games-duplicates.ts", "--out", out], { timeout: 120_000 });
      const files = readdirSync(out).sort();
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith(".json"))).toBe(true);
      const json = JSON.parse(readFileSync(join(out, files.find((f) => f.endsWith(".json"))!), "utf8")) as { groups: unknown[] };
      expect(json.groups.length).toBeGreaterThan(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    expect(await countRows()).toEqual(before);
  }, 150_000);
});
