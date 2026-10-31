import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { feedSchema, saveFeed } from "./catalog";

// Test database only (vitest.db-guard.ts). The resolver is injected: no network.

const URL_OK = "https://feeds.test-admin-feed.example/rss";
const publicDns = async () => ["93.184.216.34"];

afterAll(async () => {
  await prisma.newsFeed.deleteMany({ where: { url: { startsWith: "https://feeds.test-admin-feed.example" } } });
});

describe("saveFeed (SSRF)", () => {
  it.each([
    ["a private address", async () => ["10.0.0.7"]],
    ["the cloud metadata address", async () => ["169.254.169.254"]],
    ["loopback IPv6", async () => ["::1"]],
    ["a public and a private address", async () => ["93.184.216.34", "192.168.0.2"]],
    [
      "a name that does not resolve",
      async () => {
        throw new Error("ENOTFOUND");
      },
    ],
  ])("refuses a host that resolves to %s, without saving", async (_, resolve) => {
    const input = feedSchema.parse({ name: "Interno", url: URL_OK, active: true });
    expect(await saveFeed(input, resolve)).toMatchObject({ ok: false, field: "url" });
    expect(await prisma.newsFeed.count({ where: { url: URL_OK } })).toBe(0);
  });

  it("saves a feed whose host is public", async () => {
    const input = feedSchema.parse({ name: "Público", url: URL_OK, active: true });
    expect(await saveFeed(input, publicDns)).toEqual({ ok: true });
    expect(await prisma.newsFeed.count({ where: { url: URL_OK } })).toBe(1);
  });

  it("saves the area of a feed and keeps it when an edit leaves it out (Plan 4 F7)", async () => {
    const url = "https://feeds.test-admin-feed.example/tec";
    const created = feedSchema.parse({ name: "Tec", url, active: true, area: "TECNOLOGIA" });
    expect(await saveFeed(created, publicDns)).toEqual({ ok: true });
    const feed = await prisma.newsFeed.findUniqueOrThrow({ where: { url } });
    expect(feed.area).toBe("TECNOLOGIA");

    // Pausing sends no area: it stays TECNOLOGIA.
    expect(await saveFeed(feedSchema.parse({ id: feed.id, name: "Tec", url, active: false }), publicDns)).toEqual({ ok: true });
    expect(await prisma.newsFeed.findUniqueOrThrow({ where: { url } })).toMatchObject({ active: false, area: "TECNOLOGIA" });

    // Without an area a new feed is a GAMES feed (Plan 2 behavior).
    expect(await saveFeed(feedSchema.parse({ name: "Público 2", url: `${URL_OK}2`, active: true }), publicDns)).toEqual({ ok: true });
    expect((await prisma.newsFeed.findUniqueOrThrow({ where: { url: `${URL_OK}2` } })).area).toBe("GAMES");
  });

  it("the schema refuses an unknown area", () => {
    expect(feedSchema.safeParse({ name: "x", url: URL_OK, active: true, area: "MERCADO" }).success).toBe(false);
    expect(feedSchema.safeParse({ name: "x", url: URL_OK, active: true, area: "<script>" }).success).toBe(false);
  });

  it("the schema refuses IP literals, localhost and plain http", () => {
    for (const url of ["https://127.0.0.1/rss", "https://localhost/rss", "http://feeds.example/rss", "https://[::1]/rss"]) {
      expect(feedSchema.safeParse({ name: "x", url, active: true }).success).toBe(false);
    }
  });
});
