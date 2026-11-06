import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadGameProfile } from "@/lib/queries/game-profile";
import {
  forumRedirectPath,
  galleryRedirectHref,
  gameRedirectPath,
  loadSlugRedirect,
} from "./redirects";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-rd` prefix and are removed.
const PREFIX = "test-rd";
const KEPT = `${PREFIX}-kept`;
const OLD = `${PREFIX}-old`;

async function cleanup() {
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const game = await prisma.game.create({ data: { slug: KEPT, name: "Kept", achievementCount: 0, platforms: [] } });
  await prisma.gameSlugRedirect.create({ data: { fromSlug: OLD, gameId: game.id } });
});
afterAll(cleanup);

describe("slug redirects", () => {
  it("old slug redirects to the kept game", async () => {
    expect(await loadSlugRedirect(OLD)).toBe(KEPT);
    expect(await gameRedirectPath(OLD, "", loadSlugRedirect)).toBe(`/jogos/${KEPT}`);
  });

  it("guia subpath keeps its path", async () => {
    expect(await gameRedirectPath(OLD, "/guia", loadSlugRedirect)).toBe(`/jogos/${KEPT}/guia`);
  });

  it("unknown slug still 404s", async () => {
    expect(await loadSlugRedirect(`${PREFIX}-nobody`)).toBeNull();
    expect(await gameRedirectPath(`${PREFIX}-nobody`, "/guia", loadSlugRedirect)).toBeNull();
    expect(await forumRedirectPath(`${PREFIX}-nobody`, loadSlugRedirect)).toBeNull();
    expect(await galleryRedirectHref({ jogo: `${PREFIX}-nobody` }, loadSlugRedirect)).toBeNull();
  });

  it("forum section of an old slug redirects to the kept game's section", async () => {
    expect(await forumRedirectPath(OLD, loadSlugRedirect)).toBe(`/forum/${KEPT}`);
  });

  it("gallery filter of an old slug redirects", async () => {
    expect(await galleryRedirectHref({ jogo: OLD }, loadSlugRedirect)).toBe(`/galeria?jogo=${KEPT}`);
    // Other filters survive; a slug that was never redirected is left alone.
    expect(await galleryRedirectHref({ jogo: OLD, pagina: "2" }, loadSlugRedirect)).toBe(`/galeria?jogo=${KEPT}&pagina=2`);
    expect(await galleryRedirectHref({ jogo: KEPT }, loadSlugRedirect)).toBeNull();
    expect(await galleryRedirectHref({}, loadSlugRedirect)).toBeNull();
  });
});

describe("other editions", () => {
  it("lists the edition from both sides and nothing for a game without one", async () => {
    const a = await prisma.game.create({ data: { slug: `${PREFIX}-ed-a`, name: "Edition A", achievementCount: 0, platforms: [] } });
    const b = await prisma.game.create({ data: { slug: `${PREFIX}-ed-b`, name: "Edition B", achievementCount: 0, platforms: [] } });
    await prisma.gameEdition.create({ data: { gameId: a.id, otherId: b.id } });
    expect((await loadGameProfile(a.slug))?.editions).toEqual([{ slug: b.slug, name: "Edition B" }]);
    expect((await loadGameProfile(b.slug))?.editions).toEqual([{ slug: a.slug, name: "Edition A" }]);
    expect((await loadGameProfile(KEPT))?.editions).toEqual([]);
  });
});
