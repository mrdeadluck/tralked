import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findDuplicateCandidates, GAME_REFS, movesCell, renderMarkdown, verdictOf, type DuplicateGroup, type GameRef } from "./duplicates";

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

const ref = (id: string, name: string): GameRef => ({
  id, slug: id, name, platforms: [], steamAppId: null, igdbId: null, stub: false, hasGuide: false, players: 0,
});

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

  // Own lists on the same console on both games (neither is held by a player: catalog lists).
  for (const [slug, name, id] of [["console-a", "Test Dup Console", "NPWR3_00"], ["console-b", "Test Dup Console Complete Edition", "NPWR4_00"]] as const) {
    const g = await game(slug, name);
    await prisma.trophyList.create({ data: { gameId: g.id, platform: "psn", externalId: `${PREFIX}-${id}`, console: "PS4", name, trophyCount: 5 } });
  }

  // One plain game dropped under two Steam editions.
  await game("multi-plain", "Test Dup Multi");
  await game("multi-deluxe", "Test Dup Multi Deluxe Edition", { steamAppId: 990004 });
  await game("multi-complete", "Test Dup Multi Complete Edition", { steamAppId: 990005 });

  // A chain: chain-a is dropped under chain-b, which is dropped under chain-c... except c and b are both Steam.
  await game("chain-c", "Test Dup Chain", { steamAppId: 990011 });
  await game("chain-b", "Test Dup Chain Deluxe Edition", { steamAppId: 990010 });
  await game("chain-a", "Test Dup Chain Deluxe Edition Enhanced");

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

  it("a PSN/Xbox list on the same console on both games makes them other editions, held or not", async () => {
    const [g] = (await mine()).filter((x) => x.keep.slug.includes("console-") || x.drop.slug.includes("console-"));
    expect(g.verdict).toBe("outra-edicao");
    expect(g.reasons.join(" ")).toMatch(/mesmo console \(psn:PS4\)/);
    expect(verdictOf({ ...ref("a", "Same"), }, { ...ref("b", "Same") }, true)).toBe("outra-edicao");
    expect(verdictOf(ref("a", "Same"), ref("b", "Same"), false)).toBe("junta");
  });

  it("remaster and remastered are the same edition word", () => {
    expect(verdictOf(ref("a", "Test Remaster"), ref("b", "Test Remastered"), false)).toBe("junta");
    expect(verdictOf(ref("a", "Test"), ref("b", "Test Remastered"), false)).toBe("outra-edicao");
  });

  it("flags a drop in several groups, a keep that is dropped elsewhere, and a kept edition", async () => {
    const multi = (await mine()).filter((x) => x.drop.slug === `${PREFIX}-multi-plain`);
    expect(multi).toHaveLength(2);
    expect(multi.every((x) => x.dropGroups === 2 && x.keepIsDropIn === 0 && x.keepIsEdition)).toBe(true);

    const mineGroups = await mine();
    const chain = mineGroups.find((x) => x.drop.slug === `${PREFIX}-chain-a`)!;
    expect(chain.keep.slug).toBe(`${PREFIX}-chain-b`);
    expect(chain.keepIsDropIn).toBe(1);
    const md = renderMarkdown(mineGroups, "2026-11-06");
    expect(md).toContain("este jogo sai em 2 grupos: escolha um");
    expect(md).toContain("o jogo que fica também sai em outro grupo");
    expect(md).toContain("fica a edição; confira");
  });

  it("a name with a pipe stays in one table cell", () => {
    const group: DuplicateGroup = {
      keep: { ...ref("p", "Alice | Mirror"), slug: "alice-pipe" },
      drop: ref("q", "Alice"),
      verdict: "junta",
      reasons: ["mesmo nome"],
      moves: {},
      dropGroups: 1,
      keepIsDropIn: 0,
      keepIsEdition: false,
    };
    const row = renderMarkdown([group], "2026-11-06").split("\n").find((l) => l.includes("alice-pipe"))!;
    // Five columns make seven parts around six unescaped pipes; the pipe in the name is escaped.
    expect(row.replaceAll("\\|", "").split("|")).toHaveLength(7);
    expect(row).toContain("Alice \\| Mirror");
  });

  it("counts singular and plural", () => {
    expect(movesCell({ userGames: 1, trophyLists: 1, achievements: 2, media: 0 })).toBe("1 jogador, 1 lista de troféus, 2 conquistas");
    expect(movesCell({ userGames: 0 })).toBe("nada");
  });

  it("every column that references a game is counted", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8").split("\n");
    const refs: string[] = [];
    let model = "";
    for (const line of schema) {
      const m = /^model (\w+) \{/.exec(line);
      if (m) model = m[1];
      const r = /^\s*\w+\s+Game\??\s+(?:@relation\([^)]*fields:\s*\[(\w+)\])/.exec(line);
      if (r) refs.push(`${model}.${r[1]}`);
    }
    expect(refs.length).toBeGreaterThan(15);
    const counted = new Set(GAME_REFS.map((x) => `${x.model}.${x.column}`));
    expect(refs.filter((x) => !counted.has(x))).toEqual([]);
    expect(refs).toContain("GameEdition.otherId");
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
      expect(files).toHaveLength(3); // .json (heavy slice), .md, -completo.json
      expect(files.some((f) => f.endsWith(".json"))).toBe(true);
      const full = JSON.parse(readFileSync(join(out, files.find((f) => f.endsWith("-completo.json"))!), "utf8")) as { groups: unknown[] };
      const heavy = JSON.parse(readFileSync(join(out, files.find((f) => /\d\.json$/.test(f))!), "utf8")) as { groups: unknown[] };
      expect(full.groups.length).toBeGreaterThan(0);
      expect(heavy.groups.length).toBeLessThanOrEqual(full.groups.length);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    expect(await countRows()).toEqual(before);
  }, 150_000);
});
