import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permanentRedirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  gameRedirectPath: vi.fn(),
  getGameTitle: vi.fn(),
}));
vi.mock("next/navigation", () => ({ permanentRedirect: mocks.permanentRedirect }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/catalog/redirects", () => ({ gameRedirectPath: mocks.gameRedirectPath }));
vi.mock("@/lib/queries/games", () => ({ getGameTitle: mocks.getGameTitle }));
vi.mock("@/lib/queries/games-cached", () => ({ gameTag: (s: string) => `game:${s}` }));

import { gameMetadata } from "./metadata";

beforeEach(() => vi.clearAllMocks());

describe("gameMetadata for a missing game", () => {
  it("redirects an old slug to the kept game, keeping the sub-path", async () => {
    mocks.getGameTitle.mockResolvedValue(null);
    mocks.gameRedirectPath.mockResolvedValue("/jogos/kept/guia");
    await expect(gameMetadata("old", "/guia")).rejects.toThrow("NEXT_REDIRECT /jogos/kept/guia");
    expect(mocks.gameRedirectPath).toHaveBeenCalledWith("old", "/guia");
  });

  it("stays a not-found title when the slug is unknown", async () => {
    mocks.getGameTitle.mockResolvedValue(null);
    mocks.gameRedirectPath.mockResolvedValue(null);
    expect((await gameMetadata("nobody")).title).toContain("não encontrado");
    expect(mocks.permanentRedirect).not.toHaveBeenCalled();
  });
});
