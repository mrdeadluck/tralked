import { describe, expect, it, vi } from "vitest";
import { assertPublicHost, fetchFeed, isPublicAddress, parseFeed } from "./index";

/** Test DNS: every host is a public address (no network). */
const publicDns = async () => ["93.184.216.34"];

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

  it("stops at an unclosed <item> and stays linear on hostile input", () => {
    const valid = `<item><title>Ok</title><link>https://example.com/ok</link><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item>`;
    const hostile = `<rss>${valid}<item><title>` + "<title><![CDATA[<link ".repeat(80_000) + "<itemx".repeat(50_000);
    expect(hostile.length).toBeGreaterThan(1_500_000);
    const started = performance.now();
    const items = parseFeed(hostile, NOW);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(items.map((i) => i.url)).toEqual(["https://example.com/ok"]);
  });

  it("parses a closed 240 KB item full of unclosed <link tags in linear time", () => {
    const xml =
      `<rss><item><title>Muitos links</title>` +
      "<link ".repeat(40_000) +
      ` href="https://example.com/far">` +
      `<guid>https://example.com/guid</guid><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item></rss>`;
    expect(xml.length).toBeGreaterThan(240_000);
    const started = performance.now();
    const items = parseFeed(xml, NOW);
    expect(performance.now() - started).toBeLessThan(200);
    // The last <link is closed by the far ">" and is honored; the unclosed ones are skipped.
    expect(items.map((i) => i.url)).toEqual(["https://example.com/far"]);
  });

  it("ignores link tags longer than 2 KB", () => {
    const xml = `<feed><entry><title>Longo</title><link href="https://example.com/${"a".repeat(3000)}"/><id>x</id><updated>2026-10-28T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, NOW)).toEqual([]);
  });

  it("keeps indexes aligned when the text has characters whose lowercase is longer", () => {
    const xml = `<rss><item><title>İstanbul HOLLOW Knight</title><LINK>https://example.com/i</LINK><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item></rss>`;
    expect(parseFeed(xml, NOW)).toEqual([
      { title: "İstanbul HOLLOW Knight", url: "https://example.com/i", publishedAt: new Date("2026-10-29T10:00:00Z") },
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
    const items = await fetchFeed("https://example.org/feed", fetchMock as unknown as typeof fetch, publicDns);
    expect(items).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a chunked body (no content-length) as soon as it passes 2 MB", async () => {
    const chunk = new TextEncoder().encode("<rss>" + "x".repeat(64 * 1024));
    let pulled = 0;
    const total = Math.ceil((3 * 1024 * 1024) / chunk.byteLength); // ~3 MB
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) return controller.close();
        pulled++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const chunked = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(fetchFeed("https://x", chunked as unknown as typeof fetch, publicDns)).rejects.toThrow(/too large/);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(total);
  });

  it("fails on HTTP errors and oversized feeds", async () => {
    const notFound = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchFeed("https://x", notFound as unknown as typeof fetch, publicDns)).rejects.toThrow(/404/);
    const huge = vi.fn(async () => new Response("x".repeat(2_000_001), { status: 200 }));
    await expect(fetchFeed("https://x", huge as unknown as typeof fetch, publicDns)).rejects.toThrow(/too large/);
  });
});

describe("feed hosts (SSRF)", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "fc00::abcd",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "ff02::1", "2001:db8::1",
  ])("%s is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("refuses hosts that resolve (even partly) to private addresses, localhost, IP literals and unknown names", async () => {
    await expect(assertPublicHost("feed.example", async () => ["93.184.216.34", "10.0.0.5"])).rejects.toThrow(/non-public/);
    await expect(assertPublicHost("localhost", publicDns)).rejects.toThrow();
    await expect(assertPublicHost("127.0.0.1", publicDns)).rejects.toThrow();
    await expect(assertPublicHost("[::1]", publicDns)).rejects.toThrow();
    await expect(
      assertPublicHost("nope.example", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/resolve/);
    await expect(assertPublicHost("feed.example", publicDns)).resolves.toBeUndefined();
  });

  it("never fetches a private host, and checks every redirect hop", async () => {
    const fetchMock = vi.fn(async () => new Response(ATOM, { status: 200 }));
    await expect(
      fetchFeed("https://internal.example/feed", fetchMock as unknown as typeof fetch, async () => ["192.168.0.10"]),
    ).rejects.toThrow(/non-public/);
    expect(fetchMock).not.toHaveBeenCalled();

    const redirecting = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://feed.example")
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
        : new Response(ATOM, { status: 200 }),
    );
    await expect(fetchFeed("https://feed.example/rss", redirecting as unknown as typeof fetch, publicDns)).rejects.toThrow(
      /non-public/,
    );
    expect(redirecting).toHaveBeenCalledTimes(1);
    const [, init] = redirecting.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("follows a redirect to another public host", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "https://old.example/rss"
        ? new Response(null, { status: 301, headers: { location: "/novo" } })
        : new Response(ATOM, { status: 200 }),
    );
    expect(await fetchFeed("https://old.example/rss", fetchMock as unknown as typeof fetch, publicDns)).toHaveLength(1);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://old.example/novo");
  });
});
