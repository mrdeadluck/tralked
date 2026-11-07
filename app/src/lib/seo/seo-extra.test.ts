import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { breadcrumbJsonLd, organizationJsonLd, serializeJsonLd, websiteJsonLd } from "./json-ld";
import { buildLlmsTxt } from "./llms";
import { canonical, gameIndexable, SITE_OPEN_GRAPH } from "./metadata";

const abs = (path: string) => new URL(path, env.APP_URL).toString();

describe("page metadata helpers", () => {
  it("canonical is the bare path, without query strings", () => {
    expect(canonical("/jogos")).toEqual({ alternates: { canonical: "/jogos" } });
    expect(SITE_OPEN_GRAPH).toMatchObject({ siteName: "Tralked", locale: "pt_BR" });
  });

  it("indexes a game only when it has details and something to read", () => {
    const summary = "A rogue-like dungeon crawler from the creators of Bastion.";
    expect(gameIndexable({ stub: false, summary, achievementCount: 0 })).toBe(true);
    expect(gameIndexable({ stub: false, summary: null, achievementCount: 12 })).toBe(true);
    expect(gameIndexable({ stub: true, summary, achievementCount: 12 })).toBe(false);
    expect(gameIndexable({ stub: false, summary: "Curto.", achievementCount: 0 })).toBe(false);
    expect(gameIndexable({ stub: false, summary: null, achievementCount: 0 })).toBe(false);
  });
});

describe("home and breadcrumb structured data", () => {
  it("WebSite carries the catalog search and points at the organization", () => {
    const site = websiteJsonLd();
    expect(site).toMatchObject({
      "@type": "WebSite",
      url: abs("/"),
      publisher: { "@id": abs("/#organizacao") },
      potentialAction: { "@type": "SearchAction", target: { urlTemplate: `${abs("/jogos")}?q={search_term_string}` } },
    });
    expect(organizationJsonLd()).toMatchObject({ "@id": abs("/#organizacao"), logo: abs("/apple-icon.png") });
  });

  it("BreadcrumbList numbers the trail with absolute URLs, escaped for <script>", () => {
    const crumbs = breadcrumbJsonLd([
      { name: "Jogos", path: "/jogos" },
      { name: "</script><b>", path: "/jogos/x" },
    ]);
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Jogos", item: abs("/jogos") },
      { "@type": "ListItem", position: 2, name: "</script><b>", item: abs("/jogos/x") },
    ]);
    expect(serializeJsonLd(crumbs)).not.toContain("</script>");
  });
});

describe("llms.txt", () => {
  it("lists the sections, the guides and the latest news as absolute links", () => {
    const text = buildLlmsTxt(
      {
        guides: [{ name: "Hollow Knight", slug: "hollow-knight" }],
        articles: [{ title: "Nova [DLC]\nanunciada", slug: "nova-dlc", excerpt: "Chega em março." }],
      },
      "https://tralked.example",
    );
    expect(text.startsWith("# Tralked\n\n> ")).toBe(true);
    expect(text).toContain("- [Jogos](https://tralked.example/jogos)");
    expect(text).toContain("- [Guia 100%: Hollow Knight](https://tralked.example/jogos/hollow-knight/guia)");
    expect(text).toContain("- [Nova \\[DLC\\] anunciada](https://tralked.example/noticias/nova-dlc): Chega em março.");
    expect(text).not.toMatch(/\/(admin|conta|api)\b/);
  });

  it("leaves out empty lists", () => {
    const text = buildLlmsTxt({ guides: [], articles: [] }, "https://tralked.example");
    expect(text).not.toContain("## Guias");
    expect(text).not.toContain("## Notícias recentes");
  });
});

describe("RSS discovery", () => {
  it("home and /noticias declare the feed next to their canonical", async () => {
    const { canonicalWithFeed } = await import("./metadata");
    expect(canonicalWithFeed("/noticias")).toEqual({
      alternates: {
        canonical: "/noticias",
        types: { "application/rss+xml": [{ url: "/feed.xml", title: "Tralked: notícias de games" }] },
      },
    });
  });
});
