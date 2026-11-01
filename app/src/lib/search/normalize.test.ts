import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { cleanQuery, foldName, nameMatches } from "./normalize";

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

const SAMPLES = [
  "Pokémon: Edição Ação",
  "Marvel’s SPIDER-MAN 2",
  "Baldur's Gate 3",
  "  DOOM   Eternal ",
  "Ænima Øresund Straße",
  "ポケモン・ソード",
  "Мор. Утопия",
  "Tom Clancy’s Rainbow Six® Siege [Deluxe] (2015) / PC\\Mac",
];

describe("foldName", () => {
  it("ignores accents, case, apostrophes and punctuation", () => {
    expect(foldName("Pokémon: Edição Ação")).toBe("pokemon edicao acao");
    expect(foldName("Marvel’s SPIDER-MAN 2")).toBe("marvels spider man 2");
    expect(foldName("Baldur's Gate 3")).toBe("baldurs gate 3");
    expect(foldName("  DOOM   Eternal ")).toBe("doom eternal");
  });

  it("keeps letters of any script", () => {
    expect(foldName("ポケモン・ソード")).toBe("ポケモン ソード");
    expect(foldName("Мор. Утопия")).toBe("мор утопия");
  });

  it("matches substrings of the folded name", () => {
    expect(nameMatches("Pokémon Ação", foldName("ACAO"))).toBe(true);
    expect(nameMatches("Hollow Knight", foldName("knight"))).toBe(true);
    expect(nameMatches("Hollow Knight", foldName("celeste"))).toBe(false);
  });
});

describe("cleanQuery", () => {
  it("trims, caps and drops blanks", () => {
    expect(cleanQuery("  hades ")).toBe("hades");
    expect(cleanQuery("   ")).toBeUndefined();
    expect(cleanQuery(undefined)).toBeUndefined();
    expect(cleanQuery("x".repeat(200))).toHaveLength(80);
  });
});

const reachable = await databaseReachable();

describe.skipIf(!reachable)("foldQueryInDb (migrated database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("folds exactly like foldName", async () => {
    const { foldQueryInDb } = await import("./normalize");
    for (const sample of SAMPLES) expect(await foldQueryInDb(sample)).toBe(foldName(sample));
  });

  it("keeps Japanese and Cyrillic names under a C/POSIX locale (hosted Postgres)", async () => {
    const { prisma } = await import("@/lib/db");
    const fold = async (value: string) =>
      (await prisma.$queryRaw<{ f: string }[]>`SELECT tralked_search_name(${value}::text COLLATE "C") AS f`)[0].f;
    expect(await fold("ポケモン・ソード")).toBe("ポケモン ソード");
    // Under C only ASCII is lowercased (names and queries alike), but no letter is dropped.
    expect((await fold("Мор. Утопия")).toLowerCase()).toBe("мор утопия");
  });
});
