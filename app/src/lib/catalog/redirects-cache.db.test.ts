import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { editionPair, linkEditions } from "./editions";

const life = vi.hoisted(() => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  cacheLife: life.cacheLife,
  cacheTag: life.cacheTag,
}));

import { resolveSlugRedirect } from "./redirects";

const PREFIX = "test-rc";
const cleanup = () => prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
beforeAll(cleanup);
afterAll(cleanup);
beforeEach(() => life.cacheLife.mockClear());

describe("resolveSlugRedirect cache", () => {
  it("remembers a miss for at most a minute and a hit for hours", async () => {
    expect(await resolveSlugRedirect(`${PREFIX}-live`)).toBeNull();
    const miss = life.cacheLife.mock.calls[0]![0] as { revalidate: number; expire: number };
    expect(miss.revalidate).toBeLessThanOrEqual(60);
    expect(miss.expire).toBeLessThanOrEqual(60);

    const game = await prisma.game.create({ data: { slug: `${PREFIX}-kept`, name: "K", achievementCount: 0, platforms: [] } });
    await prisma.gameSlugRedirect.create({ data: { fromSlug: `${PREFIX}-old`, gameId: game.id } });
    life.cacheLife.mockClear();
    expect(await resolveSlugRedirect(`${PREFIX}-old`)).toBe(`${PREFIX}-kept`);
    expect(life.cacheLife).toHaveBeenCalledWith("hours");
  });
});

describe("editions", () => {
  it("stores a pair once, ordered, and refuses a game as its own edition", async () => {
    expect(editionPair("b", "a")).toEqual({ gameId: "a", otherId: "b" });
    expect(() => editionPair("a", "a")).toThrow();
    const a = await prisma.game.create({ data: { slug: `${PREFIX}-ea`, name: "A", achievementCount: 0, platforms: [] } });
    const b = await prisma.game.create({ data: { slug: `${PREFIX}-eb`, name: "B", achievementCount: 0, platforms: [] } });
    await linkEditions(a.id, b.id);
    await linkEditions(b.id, a.id);
    expect(await prisma.gameEdition.count({ where: { OR: [{ gameId: a.id }, { gameId: b.id }] } })).toBe(1);
    // The database refuses it as well, for a script that skips the helper.
    await expect(prisma.gameEdition.create({ data: { gameId: a.id, otherId: a.id } })).rejects.toThrow();
  });
});
