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

const game = (over: Record<string, unknown> = {}) => ({
  name: "Hades",
  hasGuide: false,
  stub: false,
  summary: "A rogue-like dungeon crawler from the creators of Bastion and Transistor.",
  achievementCount: 49,
  coverUrl: "https://cdn.example/cover.jpg",
  heroUrl: null,
  ...over,
});

describe("gameMetadata for a known game", () => {
  it("has its own canonical, description and share picture", async () => {
    mocks.getGameTitle.mockResolvedValue(game());
    const meta = await gameMetadata("hades");
    expect(meta.alternates?.canonical).toBe("/jogos/hades");
    expect(meta.description).toContain("49 conquistas de Hades");
    expect(meta.openGraph).toMatchObject({ siteName: "Tralked", locale: "pt_BR", url: "/jogos/hades" });
    expect(JSON.stringify(meta.openGraph)).toContain("https://cdn.example/cover.jpg");
    expect(meta.robots).toBeUndefined();
  });

  it("keeps name-only stubs and empty pages out of the index", async () => {
    mocks.getGameTitle.mockResolvedValue(game({ stub: true }));
    expect((await gameMetadata("hades")).robots).toEqual({ index: false, follow: true });
    mocks.getGameTitle.mockResolvedValue(game({ summary: null, achievementCount: 0 }));
    expect((await gameMetadata("hades")).robots).toEqual({ index: false, follow: true });
  });

  it("points /guia at the game page when there is no published guide", async () => {
    mocks.getGameTitle.mockResolvedValue(game());
    const meta = await gameMetadata("hades", "/guia");
    expect(meta.alternates?.canonical).toBe("/jogos/hades");
    expect(meta.robots).toEqual({ index: false, follow: true });
    mocks.getGameTitle.mockResolvedValue(game({ hasGuide: true }));
    const guide = await gameMetadata("hades", "/guia");
    expect(guide.alternates?.canonical).toBe("/jogos/hades/guia");
    expect(guide.robots).toBeUndefined();
  });
});

describe("gameMetadata share picture", () => {
  it("prefers the wide art and falls back to the site picture", async () => {
    mocks.getGameTitle.mockResolvedValue(game({ heroUrl: "https://cdn.example/hero.jpg" }));
    expect(JSON.stringify((await gameMetadata("hades")).openGraph)).toContain("hero.jpg");
    mocks.getGameTitle.mockResolvedValue(game({ coverUrl: null }));
    expect(JSON.stringify((await gameMetadata("hades")).openGraph)).toContain('"url":"/opengraph-image"');
  });
});
