import { describe, expect, it, vi } from "vitest";
import { fetchFeed, parseFeed } from "./index";

const NOW = new Date("2026-10-31T12:00:00Z");

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Site</title>
  <item>
    <title><![CDATA[Hollow Knight: <b>Silksong</b> ganha data]]></title>
    <link>https://example.com/hk?x=1&amp;y=2</link>
    <pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Texto longo que não deve ser copiado</p>]]></description>
  </item>
  <item>
    <title>Hades &amp; Hades II &#8212; novidades &lt;script&gt;alert(1)&lt;/script&gt;</title>
    <link>javascript:alert(1)</link>
    <guid>https://example.com/hades</guid>
    <pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Sem data</title>
    <link>https://example.com/sem-data</link>
  </item>
  <item>
    <title>Do futuro</title>
    <link>https://example.com/futuro</link>
    <pubDate>Fri, 01 Jan 2027 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">RE4 &lt;i&gt;remake&lt;/i&gt; vende muito</title>
    <link rel="replies" href="https://example.org/re4#comments"/>
    <link href="https://example.org/re4"/>
    <published>2026-10-28T09:00:00Z</published>
  </entry>
  <entry>
    <title>Link perigoso</title>
    <link href="data:text/html,oi"/>
    <updated>2026-10-28T09:00:00Z</updated>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS items as plain text with safe links only", () => {
    expect(parseFeed(RSS, NOW)).toEqual([
      {
        title: "Hollow Knight: Silksong ganha data",
        url: "https://example.com/hk?x=1&y=2",
        publishedAt: new Date("2026-10-30T10:00:00Z"),
      },
      {
        // javascript: link rejected; the guid is used instead. Escaped markup is stripped.
        title: "Hades & Hades II — novidades alert(1)",
        url: "https://example.com/hades",
        publishedAt: new Date("2026-10-29T10:00:00Z"),
      },
      { title: "Do futuro", url: "https://example.com/futuro", publishedAt: NOW },
    ]);
  });

  it("reads Atom entries (alternate link) and drops unsafe ones", () => {
    expect(parseFeed(ATOM, NOW)).toEqual([
      {
        title: "RE4 remake vende muito",
        url: "https://example.org/re4",
        publishedAt: new Date("2026-10-28T09:00:00Z"),
      },
    ]);
  });
});

describe("fetchFeed", () => {
  it("downloads with a timeout and parses", async () => {
    const fetchMock = vi.fn(async () => new Response(ATOM, { status: 200 }));
    const items = await fetchFeed("https://example.org/feed", fetchMock as unknown as typeof fetch);
    expect(items).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails on HTTP errors and oversized feeds", async () => {
    const notFound = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchFeed("https://x", notFound as unknown as typeof fetch)).rejects.toThrow(/404/);
    const huge = vi.fn(async () => new Response("x".repeat(2_000_001), { status: 200 }));
    await expect(fetchFeed("https://x", huge as unknown as typeof fetch)).rejects.toThrow(/too large/);
  });
});
