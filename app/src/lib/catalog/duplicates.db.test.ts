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
const slug = (s: string) => `${PREFIX}-${s}`;

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

let all: DuplicateGroup[] = [];
const mine = () => all.filter((g) => g.keep.slug.startsWith(PREFIX) || g.drop.slug.startsWith(PREFIX));
/** The groups between two fixtures (either order). */
const between = (a: string, b: string) =>
  mine().filter((g) => [g.keep.slug, g.drop.slug].sort().join() === [slug(a), slug(b)].sort().join());

let userId = "";
const game = (name: string, key: string, extra: Record<string, unknown> = {}) =>
  prisma.game.create({ data: { slug: slug(key), name, achievementCount: 0, platforms: ["PLAYSTATION"], ...extra } });
/** A player owns the game: the game has content to move. */
const owned = async (g: { id: string }) => {
  await prisma.userGame.create({ data: { userId, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 0 } });
  return g;
};
const list = (gameId: string, externalId: string, name: string, console: string | null, conceptId: number | null = null) =>
  prisma.trophyList.create({
    data: { gameId, platform: "psn", externalId: `${PREFIX}-${externalId}`, console, name, trophyCount: 5, conceptId },
  });
const guideOf = (gameId: string) =>
  prisma.guide.create({
    data: { gameId, status: "draft", version: "1", difficulty: 3, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 0, online: 0, overview: [], warnings: [] },
  });
const ref = (id: string, name: string): GameRef => ({
  id, slug: id, name, platforms: [], steamAppId: null, igdbId: null, stub: false, hasGuide: false, players: 0,
});

beforeAll(async () => {
  await cleanup();
  userId = (await prisma.user.create({ data: { handle: `${PREFIX}-player`, displayName: "Player" } })).id;

  // Ghost of Yōtei and its store edition: the edition has a catalog list nobody holds and a player.
  await game("Ghost of Yōtei", "yotei");
  const dd = await owned(await game("Ghost of Yotei: Digital Deluxe Edition", "yotei-dd"));
  await list(dd.id, "NPWR1_00", "Ghost of Yotei", "PS5");

  await game("Test Dup Steam Twin", "steam-a", { steamAppId: 990001 });
  await game("Test Dup Steam Twin", "steam-b", { steamAppId: 990002 });

  await game("Test Dup Strand", "strand");
  await game("Test Dup Strand Director's Cut", "strand-dc");

  const ga = await game("Test Dup Guided", "guide-a");
  const gb = await game("Test Dup Guided Complete Edition", "guide-b");
  await guideOf(ga.id);
  await guideOf(gb.id);

  await game("Test Dup Ranked", "plain-old");
  await game("Test Dup Ranked Definitive Edition", "plain-steam", { steamAppId: 990003 });

  // A PSN list that sits on one game while its name maps to another (the phase-e match check).
  const holder = await game("Test Dup Holder Collection", "holder");
  await game("Test Dup Holder", "target");
  await list(holder.id, "NPWR2_00", "Test Dup Holder", "PS4");

  // Lists on the same console on both games (catalog lists nobody holds).
  const ca = await game("Test Dup Console", "console-a");
  const cb = await game("Test Dup Console Complete Edition", "console-b");
  await list(ca.id, "NPWR3_00", "Test Dup Console", "PS4");
  await list(cb.id, "NPWR4_00", "Test Dup Console Complete Edition", "PS4");

  // The same game on different platforms: PSN only and Steam only.
  const psnOnly = await owned(await game("Test Dup Cross", "cross-psn"));
  await list(psnOnly.id, "NPWR5_00", "Test Dup Cross", "PS5");
  await game("Test Dup Cross", "cross-steam", { steamAppId: 990040, platforms: ["PC"] });

  // A shared PSN concept with different names and consoles.
  const one = await owned(await game("Test Dup Concept One", "concept-one"));
  const uno = await owned(await game("Test Dup Concept Uno", "concept-uno"));
  await list(one.id, "NPWR6_00", "Test Dup Concept One", "PS5", 41001);
  await list(uno.id, "NPWR6_01", "Test Dup Concept Uno", "PS4", 41001);

  // GTA V: one PSN game, two Steam games.
  const gta = await owned(await game("Test Dup Gta", "gta"));
  await list(gta.id, "NPWR7_00", "Test Dup Gta", "PS4");
  await game("Test Dup Gta Enhanced", "gta-enhanced", { steamAppId: 990050, platforms: ["PC"] });
  await game("Test Dup Gta Legacy", "gta-legacy", { steamAppId: 990051, platforms: ["PC"] });

  // One game whose two lists are platform links of two different Steam games: it would be dropped twice.
  const many = await owned(await game("Test Dup Many", "many"));
  await list(many.id, "NPWR8_00", "Test Dup Many", "PS4");
  await list(many.id, "NPWR9_00", "Test Dup Many", "PS5");
  const ma = await game("Test Dup Manya", "many-a", { steamAppId: 990060, platforms: ["PC"] });
  const mb = await game("Test Dup Manyb", "many-b", { steamAppId: 990061, platforms: ["PC"] });
  await prisma.gamePlatformLink.create({ data: { gameId: ma.id, platform: "psn", externalId: `${PREFIX}-NPWR8_00` } });
  await prisma.gamePlatformLink.create({ data: { gameId: mb.id, platform: "psn", externalId: `${PREFIX}-NPWR9_00` } });

  // A base game and its Digital Deluxe edition with players on the edition: the base slug survives.
  const base = await game("Test Dup Dlx", "dlx");
  const dlx = await owned(await game("Test Dup Dlx Digital Deluxe Edition", "dlx-dd"));
  await list(base.id, "NPWR10_00", "Test Dup Dlx", "PS5", 42001);
  await list(dlx.id, "NPWR11_00", "Test Dup Dlx", "PS5", 42001);

  // Two empty catalog entries with one name.
  await game("Test Dup Placeholder", "ph-a");
  await game("Test Dup Placeholder", "ph-b");

  // A chain across verdicts.
  await game("Test Dup Chain", "chain-c", { steamAppId: 990011 });
  await game("Test Dup Chain Deluxe Edition", "chain-b", { steamAppId: 990010 });
  await game("Test Dup Chain Deluxe Edition Enhanced", "chain-a");

  all = await findDuplicateCandidates();
});
afterAll(cleanup);

describe("duplicate candidates", () => {
  it("ghost-of-yotei and its digital deluxe edition are one group", () => {
    const groups = mine().filter((g) => g.keep.slug.includes("yotei") || g.drop.slug.includes("yotei"));
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g.verdict).toBe("junta");
    // The edition has the player, so the rank keeps it; the plain slug survives anyway.
    expect(g.keep.slug).toBe(slug("yotei"));
    expect(g.drop.slug).toBe(slug("yotei-dd"));
    expect(g.reasons.length).toBeGreaterThan(0);
    // The catalog list nobody holds moves with the game.
    expect(g.moves.catalogLists).toBe(1);
    expect(g.moves.trophyLists).toBe(1);
  });

  it("two steam games are never joined", () => {
    const [g] = between("steam-a", "steam-b");
    expect(g.verdict).toBe("nao-junta-steam");
  });

  it("Death Stranding and Director's Cut are other editions", () => {
    const [g] = between("strand", "strand-dc");
    expect(g.verdict).toBe("outra-edicao");
    expect(g.keep.slug).toBe(slug("strand"));
  });

  it("two games with a guide are never joined", () => {
    expect(between("guide-a", "guide-b")[0].verdict).toBe("nao-junta-guia");
  });

  it("the Steam game is the one that stays", () => {
    const [g] = between("plain-old", "plain-steam");
    expect(g.keep.slug).toBe(slug("plain-steam"));
    expect(g.verdict).toBe("outra-edicao"); // Definitive
  });

  it("a PSN list sitting on a game whose name maps to another is surfaced", () => {
    const groups = between("holder", "target");
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons.join(" ")).toMatch(/NPWR2_00/);
    expect(groups[0].verdict).not.toBe("junta");
  });

  it("a shared conceptId gives junta", () => {
    const [g] = between("concept-one", "concept-uno");
    expect(g.verdict).toBe("junta");
    expect(g.reasons.join(" ")).toMatch(/conceito/);
  });

  it("PSN-only vs Steam-only with the same name gives junta", () => {
    const [g] = between("cross-psn", "cross-steam");
    expect(g.verdict).toBe("junta");
    expect(g.keep.slug).toBe(slug("cross-steam"));
  });

  it("both with a PS4 list gives outra-edicao", () => {
    const [g] = between("console-a", "console-b");
    expect(g.verdict).toBe("outra-edicao");
    expect(g.reasons.join(" ")).toMatch(/mesmo console \(psn:PS4\)/);
  });

  it("GTA V-like PSN vs two Steam appids gives two outra-edicao", () => {
    const groups = [...between("gta", "gta-enhanced"), ...between("gta", "gta-legacy")];
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.verdict === "outra-edicao")).toBe(true);
    expect(groups.every((g) => g.drop.slug === slug("gta"))).toBe(true);
  });

  it("a drop appearing in 2 junta groups gives revisar", () => {
    const groups = mine().filter((g) => g.drop.slug === slug("many"));
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.verdict === "revisar" && g.dropGroups === 2)).toBe(true);
    expect(groups[0].reasons.join(" ")).toMatch(/2 juntas/);
  });

  it("Digital Deluxe vs base with the same concept gives junta keeping the base slug", () => {
    const [g] = between("dlx", "dlx-dd");
    expect(g.verdict).toBe("junta");
    expect(g.keep.slug).toBe(slug("dlx"));
    expect(g.drop.slug).toBe(slug("dlx-dd"));
    expect(g.keepIsEdition).toBe(false);
  });

  it("a placeholder never gives junta", () => {
    const [g] = between("ph-a", "ph-b");
    expect(g.verdict).toBe("placeholder");
  });

  it("verdictOf follows the rules in order", () => {
    const facts = { sameList: false, sharedConsole: false };
    expect(verdictOf(ref("a", "Same"), ref("b", "Same"), { ...facts, sharedConsole: true })).toBe("outra-edicao");
    expect(verdictOf(ref("a", "Same"), ref("b", "Same"), { ...facts, sameList: true, sharedConsole: true })).toBe("junta");
    expect(verdictOf(ref("a", "Same"), ref("b", "Same"), facts)).toBe("junta");
    expect(verdictOf(ref("a", "Same"), ref("b", "Other"), facts)).toBe("revisar");
    expect(verdictOf(ref("a", "Test Remaster"), ref("b", "Test Remastered"), facts)).toBe("revisar");
    expect(verdictOf(ref("a", "Test"), ref("b", "Test Remastered"), facts)).toBe("outra-edicao");
    expect(verdictOf(ref("a", "Test"), ref("b", "Test Enhanced"), facts)).toBe("outra-edicao");
    expect(verdictOf(ref("a", "Test Remastered"), ref("b", "Test Remastered"), facts)).toBe("junta");
  });

  it("flags a keep that is dropped elsewhere", () => {
    const g = mine().find((x) => x.drop.slug === slug("chain-a"))!;
    expect(g.keep.slug).toBe(slug("chain-b"));
    expect(g.keepIsDropIn).toBe(1);
  });

  it("the markdown puts what to decide first, with a checkbox per row, and the notes", () => {
    const edition: DuplicateGroup = {
      keep: { ...ref("k", "Edition Complete Edition"), slug: "keep-edition" },
      drop: ref("d", "Edition"),
      verdict: "outra-edicao",
      reasons: ["mesmo nome"],
      moves: {},
      dropGroups: 1,
      keepIsDropIn: 0,
      keepIsEdition: true,
    };
    const md = renderMarkdown([...mine(), edition], "2026-11-06");
    expect(md.indexOf("## Para você decidir")).toBeGreaterThan(-1);
    expect(md.indexOf("## Para você decidir")).toBeLessThan(md.indexOf("## Juntas automáticas"));
    expect(md.indexOf("## Juntas automáticas")).toBeLessThan(md.indexOf("## Outras edições (automático)"));
    expect(md).toContain("[ ] juntar");
    expect(md).toContain(slug("many"));
    expect(md).toContain("este jogo sai em 2 grupos: escolha um");
    expect(md).toContain("o jogo que fica também sai em outro grupo");
    expect(md).toContain("fica a edição; confira");
  });

  it("a name with a pipe stays in one table cell", () => {
    const group: DuplicateGroup = {
      keep: { ...ref("p", "Alice | Mirror"), slug: "alice-pipe" },
      drop: ref("q", "Alice"),
      verdict: "revisar",
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
