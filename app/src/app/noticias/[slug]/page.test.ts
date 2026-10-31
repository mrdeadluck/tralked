import { afterAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

// The page's cache directives are no-ops outside Next; notFound() throws like the real one.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

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

describe.skipIf(!reachable)("/noticias/[slug] (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  const props = (slug: string) => ({ params: Promise.resolve({ slug }) }) as PageProps<"/noticias/[slug]">;

  it("an unknown slug is a real 404", async () => {
    const { default: NoticiaPage } = await import("./page");
    await expect(NoticiaPage(props("nao-existe"))).rejects.toThrow("404");
  });

  it("a draft is a 404 too", async () => {
    const { prisma } = await import("@/lib/db");
    const { default: NoticiaPage } = await import("./page");
    const author = await prisma.author.findFirstOrThrow();
    const draft = await prisma.article.create({
      data: { slug: "test-page-draft", title: "Rascunho", body: "x", category: "GAMES", imageLabel: "x", authorId: author.id },
    });
    try {
      await expect(NoticiaPage(props(draft.slug))).rejects.toThrow("404");
    } finally {
      await prisma.article.delete({ where: { id: draft.id } });
    }
  });

  it("a published article renders and has metadata", async () => {
    const { default: NoticiaPage, generateMetadata } = await import("./page");
    const slug = "25-conquistas-mais-raras-da-steam-em-2026";
    await expect(NoticiaPage(props(slug))).resolves.toBeTruthy();
    const metadata = await generateMetadata(props(slug) as never);
    expect(metadata.title).toMatch(/\| Tralked$/);
    expect(metadata.description).toBeTruthy();
    expect((await generateMetadata(props("nao-existe") as never)).title).toBe("Notícia não encontrada | Tralked");
  });
});
