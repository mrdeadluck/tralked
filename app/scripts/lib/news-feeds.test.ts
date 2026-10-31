import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { RecommendedFeed } from "@/lib/news/feed-catalog";

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
const BASE = "https://feeds.test-news-feeds-script.example/";
const FEEDS: RecommendedFeed[] = [
  { name: "Script Ent", url: `${BASE}ent`, area: "ENTRETENIMENTO", language: "pt-BR" },
  { name: "Script Tec", url: `${BASE}tec`, area: "TECNOLOGIA", language: "en" },
];

describe.skipIf(!reachable)("addRecommendedFeeds", () => {
  const cleanup = async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.newsFeed.deleteMany({ where: { url: { startsWith: BASE } } });
  };
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("dry run writes nothing; a real run adds missing feeds once and never touches existing ones", async () => {
    const { prisma } = await import("@/lib/db");
    const { addRecommendedFeeds } = await import("./news-feeds");
    // The admin already registered (and paused, renamed) the tech feed.
    await prisma.newsFeed.create({ data: { name: "Renomeado", url: `${BASE}tec`, area: "TECNOLOGIA", active: false } });

    const dry = await addRecommendedFeeds(prisma, FEEDS, { dryRun: true, active: true });
    expect(dry.added.map((f) => f.name)).toEqual(["Script Ent"]);
    expect(await prisma.newsFeed.count({ where: { url: { startsWith: BASE } } })).toBe(1);

    const run = await addRecommendedFeeds(prisma, FEEDS, { dryRun: false, active: true });
    expect(run.added.map((f) => f.name)).toEqual(["Script Ent"]);
    expect(run.kept).toEqual([{ feed: FEEDS[1], active: false, area: "TECNOLOGIA" }]);
    const rows = await prisma.newsFeed.findMany({ where: { url: { startsWith: BASE } }, orderBy: { url: "asc" } });
    expect(rows.map((r) => [r.name, r.area, r.active])).toEqual([
      ["Script Ent", "ENTRETENIMENTO", true],
      ["Renomeado", "TECNOLOGIA", false],
    ]);

    const again = await addRecommendedFeeds(prisma, FEEDS, { dryRun: false, active: true });
    expect(again.added).toEqual([]);
  });
});
