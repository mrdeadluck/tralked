import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

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
const FEED_URL = "https://feeds.test-news.example/rss";
const BROKEN_URL = "https://feeds.test-news.example/broken";
const INACTIVE_URL = "https://feeds.test-news.example/off";
const ITEM_BASE = "https://news.test-news.example/";
/** Test DNS: every feed host is a public address (no network). */
const publicDns = async () => ["93.184.216.34"];

const item = (title: string, slug: string) => `<item>
  <title>${title}</title>
  <link>${ITEM_BASE}${slug}</link>
  <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
  <description>Texto completo que não deve ser guardado.</description>
</item>`;

const RSS = `<rss><channel>
${item("Hollow Knight recebe atualização surpresa", "hk-update")}
${item("Speedrun de HK bate recorde", "hk-short-alias")}
${item("Chunky HKD prices", "not-hk")}
${item("Hades II sai do acesso antecipado", "hades-2")}
${item("Mercado de consoles cresce", "unrelated")}
${item("Resident Evil 4 &amp; Hollow Knight lideram vendas", "two-games")}
</channel></rss>`;

describe.skipIf(!reachable)("syncExternalNews", () => {
  const cleanup = async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.externalNews.deleteMany({ where: { url: { startsWith: ITEM_BASE } } });
    await prisma.newsFeed.deleteMany({ where: { url: { in: [FEED_URL, BROKEN_URL, INACTIVE_URL] } } });
  };

  beforeAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.newsFeed.createMany({
      data: [
        { name: "Teste Notícias", url: FEED_URL, active: true },
        { name: "Teste Quebrado", url: BROKEN_URL, active: true },
        { name: "Teste Desligado", url: INACTIVE_URL, active: false },
      ],
    });
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("stores title, link, source and date of items about catalog games, once", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncExternalNews } = await import("./external-news");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === FEED_URL) return new Response(RSS, { status: 200 });
      if (url === BROKEN_URL) return new Response("", { status: 500 });
      // Seeded placeholder feeds are inactive; anything else would be a bug.
      throw new Error(`unexpected fetch ${url}`);
    });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await syncExternalNews(fetchMock as unknown as typeof fetch, publicDns);
    expect(first).toMatchObject({ processed: 1, failed: 1, created: 4 });
    // The broken feed is logged by name only, without its URL.
    expect(logged).toHaveBeenCalledWith("News: could not read feed Teste Quebrado", "Feed request failed with HTTP 500");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(INACTIVE_URL);

    const stored = await prisma.externalNews.findMany({
      where: { url: { startsWith: ITEM_BASE } },
      include: { game: { select: { slug: true } } },
      orderBy: { url: "asc" },
    });
    expect(stored.map((n) => [n.url.slice(ITEM_BASE.length), n.game?.slug])).toEqual([
      ["hades-2", "hades"],
      ["hk-short-alias", "hollow-knight"], // "HK" alias, exact case, whole word
      ["hk-update", "hollow-knight"],
      // Two games named: the longer name wins ("resident evil 4" over "hollow knight").
      ["two-games", "resident-evil-4"],
    ]);
    expect(stored[0]).toMatchObject({
      title: "Hades II sai do acesso antecipado",
      source: "Teste Notícias",
      publishedAt: new Date("2026-10-29T10:00:00Z"),
    });

    const again = await syncExternalNews(fetchMock as unknown as typeof fetch, publicDns);
    expect(again.created).toBe(0);
    logged.mockRestore();
  });
});

describe.skipIf(!reachable)("syncExternalNews areas (Plan 4 F7)", () => {
  const ENT_URL = "https://feeds.test-news-area.example/ent";
  const TEC_URL = "https://feeds.test-news-area.example/tec";
  const BASE = "https://news.test-news-area.example/";
  const areaItem = (title: string, slug: string) => item(title, slug).replace(ITEM_BASE, BASE);
  const ENT = `<rss><channel>
${areaItem("Anime de Elden Ring é anunciado", "ent-elden")}
${areaItem("Série de Fallout renovada para a 3ª temporada", "ent-fallout")}
${areaItem("Dead Space: filme de terror espacial ganha diretor", "ent-dead-space-film")}
${areaItem("Filme do jogo Dead Space ganha diretor", "ent-dead-space-game")}
${areaItem("Hades: filme sobre mitologia grega estreia", "ent-hades-myth")}
${areaItem("Jogos Vorazes: novo filme ganha trailer", "ent-hunger")}
${areaItem("Nova placa de vídeo chega às lojas", "ent-gpu")}
</channel></rss>`;
  const TEC = `<rss><channel>
${areaItem("Nova placa de vídeo da Nvidia chega ao Brasil", "tec-gpu")}
${areaItem("Como a IA está mudando os estúdios", "tec-ai")}
${areaItem("Banco lança novo aplicativo", "tec-bank")}
</channel></rss>`;

  const cleanup = async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.externalNews.deleteMany({ where: { url: { startsWith: BASE } } });
    await prisma.newsFeed.deleteMany({ where: { url: { in: [ENT_URL, TEC_URL] } } });
  };
  beforeAll(cleanup);
  afterAll(cleanup);

  it("keeps only the headlines of each feed's area, stores the area and links games", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncExternalNews } = await import("./external-news");
    await prisma.newsFeed.createMany({
      data: [
        { name: "Teste Entretenimento", url: ENT_URL, active: true, area: "ENTRETENIMENTO" },
        { name: "Teste Tecnologia", url: TEC_URL, active: true, area: "TECNOLOGIA" },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === ENT_URL) return new Response(ENT, { status: 200 });
      if (url === TEC_URL) return new Response(TEC, { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await syncExternalNews(fetchMock as unknown as typeof fetch, publicDns);
    expect(result).toMatchObject({ processed: 2, failed: 0, created: 4 });

    const stored = await prisma.externalNews.findMany({
      where: { url: { startsWith: BASE } },
      include: { game: { select: { slug: true } } },
      orderBy: { url: "asc" },
    });
    expect(stored.map((n) => [n.url.slice(BASE.length), n.area, n.game?.slug ?? null, n.source])).toEqual([
      // A catalog name alone neither keeps nor links ("Dead Space: filme..."); with "jogo" it does.
      // "Série de Fallout" has no gaming signal (Fallout is also an ordinary word): dropped.
      ["ent-dead-space-game", "ENTRETENIMENTO", "dead-space", "Teste Entretenimento"],
      ["ent-elden", "ENTRETENIMENTO", "elden-ring", "Teste Entretenimento"],
      ["tec-ai", "TECNOLOGIA", null, "Teste Tecnologia"],
      ["tec-gpu", "TECNOLOGIA", null, "Teste Tecnologia"],
    ]);
  });
});
