import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordArticleView = vi.fn();
vi.mock("@/lib/news/views", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/news/views")>()),
  recordArticleView,
}));

const { POST } = await import("./route");

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let ip = 0;
function beacon(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/views", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "user-agent": CHROME, "sec-fetch-site": "same-origin", "x-forwarded-for": `10.0.0.${ip}`, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ip++;
  recordArticleView.mockResolvedValue(true);
});

describe("POST /api/views", () => {
  it("counts a browser's view once per visitor and article within the window", async () => {
    const response = await POST(beacon({ articleId: "art1" }));
    expect(response.status).toBe(204);
    await POST(beacon({ articleId: "art1" }));
    await POST(beacon({ articleId: "art2" }));
    expect(recordArticleView.mock.calls.map((c) => c[0])).toEqual(["art1", "art2"]);
  });

  it("ignores bots, prefetches, other sites and malformed bodies (always 204)", async () => {
    const ignored = [
      beacon({ articleId: "a" }, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
      beacon({ articleId: "a" }, { "sec-purpose": "prefetch" }),
      beacon({ articleId: "a" }, { "sec-fetch-site": "cross-site" }),
      beacon("not json"),
      beacon({ articleId: "<script>" }),
      beacon({ articleId: 42 }),
      beacon({ articleId: "x".repeat(600) }),
    ];
    for (const request of ignored) expect((await POST(request)).status).toBe(204);
    expect(recordArticleView).not.toHaveBeenCalled();
  });

  it("never fails the beacon when the database does", async () => {
    recordArticleView.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(beacon({ articleId: "art3" }))).status).toBe(204);
    spy.mockRestore();
  });
});
