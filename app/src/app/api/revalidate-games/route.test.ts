import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag: cache.revalidateTag,
}));

import { POST } from "./route";

const call = (body: unknown, authorization: string | null = `Bearer ${env.CRON_SECRET}`) =>
  POST(
    new Request("http://localhost/api/revalidate-games", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as never,
  );

beforeEach(() => cache.revalidateTag.mockClear());

describe("POST /api/revalidate-games", () => {
  it("refuses a request without the secret or with a wrong one", async () => {
    expect((await call({ slugs: ["a"] }, null)).status).toBe(401);
    expect((await call({ slugs: ["a"] }, "Bearer wrong")).status).toBe(401);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it("validates the body: 1 to 200 slugs of the slug pattern", async () => {
    expect((await call("not json")).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ slugs: [] })).status).toBe(400);
    expect((await call({ slugs: ["Bad Slug!"] })).status).toBe(400);
    expect((await call({ slugs: Array.from({ length: 201 }, (_, i) => `g-${i}`) })).status).toBe(400);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it("expires every game tag, the forum tag and the gallery tag once", async () => {
    const response = await call({ slugs: ["old-game", "kept-game", "old-game"] });
    expect(response.status).toBe(200);
    expect(cache.revalidateTag.mock.calls).toEqual([
      ["game:old-game", { expire: 0 }],
      ["game:kept-game", { expire: 0 }],
      ["forum", { expire: 0 }],
      ["gallery", { expire: 0 }],
    ]);
  });
});
