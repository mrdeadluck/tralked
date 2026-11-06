import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { IgdbCatalogGame } from "@/lib/integrations/igdb/catalog-types";
import { resolveIgdbGames } from "@/lib/sync/igdb-games";
import { backfillIgdbAliases, joinsFromFiles } from "./igdb-aliases";
import { mergeGames } from "./merge-games";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-iga` prefix and are removed.
const PREFIX = "test-iga";
const IGDB = 97_300_000;
const NOW = new Date("2026-11-06T12:00:00Z");

let counter = 0;
const next = () => `${PREFIX}-${++counter}`;

async function cleanup() {
  await prisma.gameSlugRedirect.deleteMany({ where: { fromSlug: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { OR: [{ slug: { startsWith: PREFIX } }, { igdbId: { gte: IGDB, lt: IGDB + 1000 } }] } });
}

beforeAll(cleanup);
afterAll(cleanup);

const newGame = (extra: Record<string, unknown> = {}) => {
  const slug = next();
  return prisma.game.create({ data: { slug, name: `Test Iga ${slug}`, achievementCount: 0, platforms: ["PLAYSTATION"], ...extra } });
};

const igdbGame = (igdbId: number, name: string): IgdbCatalogGame => ({ igdbId, name, platforms: [48], steamAppIds: [], popularity: 0 });

describe("IGDB aliases", () => {
  it("an IGDB import finds a game by an alias and creates nothing", async () => {
    const keep = await newGame({ igdbId: IGDB + 1 });
    await prisma.gameIgdbAlias.create({ data: { igdbId: IGDB + 2, gameId: keep.id } });

    const result = await resolveIgdbGames([igdbGame(IGDB + 2, "Test Iga Edição Antiga"), igdbGame(IGDB + 1, keep.name)]);

    expect(result.ids.get(IGDB + 2)).toBe(keep.id);
    expect(result.ids.get(IGDB + 1)).toBe(keep.id);
    expect(result.created).toBe(0);
    expect(await prisma.game.count({ where: { igdbId: IGDB + 2 } })).toBe(0);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: keep.id } })).igdbId).toBe(IGDB + 1);
  });

  it("a merge keeps the drop's IGDB id (and its aliases) as aliases of the keep, and the drop never comes back", async () => {
    const keep = await newGame({ igdbId: IGDB + 10 });
    const drop = await newGame({ igdbId: IGDB + 11, name: "Test Iga Volta Nao" });
    await prisma.gameIgdbAlias.create({ data: { igdbId: IGDB + 12, gameId: drop.id } });
    // An alias of the drop that is the keep's own id is not kept (the keep already has it).
    await prisma.gameIgdbAlias.create({ data: { igdbId: IGDB + 10, gameId: drop.id } });

    await mergeGames(keep.id, drop.id, { now: NOW });

    const aliases = await prisma.gameIgdbAlias.findMany({ where: { gameId: keep.id }, orderBy: { igdbId: "asc" } });
    expect(aliases.map((a) => a.igdbId)).toEqual([IGDB + 11, IGDB + 12]);

    const result = await resolveIgdbGames([igdbGame(IGDB + 11, "Test Iga Volta Nao"), igdbGame(IGDB + 12, "Test Iga Volta Nao")]);
    expect(result.created).toBe(0);
    expect(result.ids.get(IGDB + 11)).toBe(keep.id);
    expect(result.ids.get(IGDB + 12)).toBe(keep.id);
    expect(await prisma.game.findUnique({ where: { slug: drop.slug } })).toBeNull();
  });

  it("a keep without an IGDB id inherits the drop's and gets no alias for it", async () => {
    const keep = await newGame();
    const drop = await newGame({ igdbId: IGDB + 20 });
    await mergeGames(keep.id, drop.id, { now: NOW });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: keep.id } })).igdbId).toBe(IGDB + 20);
    expect(await prisma.gameIgdbAlias.count({ where: { gameId: keep.id } })).toBe(0);
  });

  it("a new IGDB game whose name gives the slug of a redirect takes another slug", async () => {
    const target = await newGame();
    const old = next();
    await prisma.gameSlugRedirect.create({ data: { fromSlug: old, gameId: target.id } });

    const result = await resolveIgdbGames([igdbGame(IGDB + 30, old.replace(/-/g, " "))]);

    expect(result.created).toBe(1);
    const stub = await prisma.game.findUniqueOrThrow({ where: { id: result.ids.get(IGDB + 30)! } });
    expect(stub.slug).toBe(`${old}-${IGDB + 30}`);
  });
});

describe("backfillIgdbAliases", () => {
  it("adds the dropped ids the keeps do not have, and the dry run writes nothing", async () => {
    const keepA = await newGame({ igdbId: IGDB + 40 });
    const keepB = await newGame({ igdbId: IGDB + 43 }); // inherited the drop's id
    const keepC = await newGame({ igdbId: IGDB + 44 });
    const recreated = await newGame({ igdbId: IGDB + 45 }); // a stub on a dropped id: a conflict, left alone
    const joins = [
      { keepId: keepA.id, keepSlug: keepA.slug, dropSlug: `${PREFIX}-old-a`, dropIgdbId: IGDB + 41 },
      { keepId: keepA.id, keepSlug: keepA.slug, dropSlug: `${PREFIX}-old-a2`, dropIgdbId: IGDB + 42 },
      { keepId: keepB.id, keepSlug: keepB.slug, dropSlug: `${PREFIX}-old-b`, dropIgdbId: IGDB + 43 },
      { keepId: keepC.id, keepSlug: keepC.slug, dropSlug: `${PREFIX}-old-c`, dropIgdbId: IGDB + 45 },
      { keepId: keepC.id, keepSlug: keepC.slug, dropSlug: `${PREFIX}-old-c2`, dropIgdbId: null },
    ];

    const dry = await backfillIgdbAliases(joins, { dryRun: true });
    expect(dry.added.map((a) => a.igdbId)).toEqual([IGDB + 41, IGDB + 42]);
    expect(dry.keepsOwn).toBe(1);
    expect(dry.withoutIgdbId).toBe(1);
    expect(dry.conflicts.map((c) => c.igdbId)).toEqual([IGDB + 45]);
    expect(await prisma.gameIgdbAlias.count({ where: { gameId: { in: [keepA.id, keepB.id, keepC.id] } } })).toBe(0);

    const real = await backfillIgdbAliases(joins, { dryRun: false });
    expect(real.added.length).toBe(2);
    expect((await prisma.gameIgdbAlias.findMany({ where: { gameId: keepA.id } })).map((a) => a.igdbId).sort()).toEqual([IGDB + 41, IGDB + 42]);
    expect(await prisma.gameIgdbAlias.count({ where: { igdbId: IGDB + 45 } })).toBe(0);
    expect(await prisma.game.count({ where: { id: recreated.id } })).toBe(1);

    // Idempotent: a second run finds them already there.
    const again = await backfillIgdbAliases(joins, { dryRun: false });
    expect(again.added).toEqual([]);
    expect(again.alreadyAlias).toBe(2);
  });

  it("a keep joined again later is followed through its redirect", async () => {
    const final = await newGame({ igdbId: IGDB + 50 });
    const goneSlug = next();
    await prisma.gameSlugRedirect.create({ data: { fromSlug: goneSlug, gameId: final.id } });
    const result = await backfillIgdbAliases(
      [{ keepId: "gone-id", keepSlug: goneSlug, dropSlug: `${PREFIX}-old-z`, dropIgdbId: IGDB + 51 }],
      { dryRun: false },
    );
    expect(result.added).toEqual([{ igdbId: IGDB + 51, gameSlug: final.slug, dropSlug: `${PREFIX}-old-z` }]);
    expect(result.missingKeep).toEqual([]);
  });
});

describe("joinsFromFiles", () => {
  const approved = {
    merges: [
      { keep: { id: "k1", slug: "keep-1" }, drop: { id: "d1", slug: "drop-1" } },
      { keep: { id: "k2", slug: "keep-2" }, drop: { id: "d2", slug: "drop-2" } },
      { keep: { id: "k3", slug: "keep-3" }, drop: { id: "d3", slug: "drop-3" } },
    ],
  };
  const report = {
    groups: [
      { keep: { id: "k1", slug: "keep-1", igdbId: 1 }, drop: { id: "d1", slug: "drop-1", igdbId: 11 } },
      { keep: { id: "k9", slug: "other", igdbId: 9 }, drop: { id: "d1", slug: "drop-1", igdbId: 11 } },
      { keep: { id: "k2", slug: "keep-2", igdbId: null }, drop: { id: "d2", slug: "drop-2", igdbId: null } },
    ],
  };
  const record = { merges: [{ keep: "keep-1", drop: "drop-1" }, { keep: "keep-2", drop: "drop-2" }] };

  it("takes each approved join that ran, with the drop's IGDB id from the report", () => {
    const { joins, problems } = joinsFromFiles(approved, report, record);
    expect(joins).toEqual([
      { keepId: "k1", keepSlug: "keep-1", dropSlug: "drop-1", dropIgdbId: 11 },
      { keepId: "k2", keepSlug: "keep-2", dropSlug: "drop-2", dropIgdbId: null },
    ]);
    // d3: approved, but neither in the report nor in the record of the run.
    expect(problems).toEqual([
      expect.stringContaining("drop-3"),
      expect.stringContaining("drop-3"),
    ]);
  });
});
