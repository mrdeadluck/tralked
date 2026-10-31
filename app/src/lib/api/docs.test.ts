import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guidePayloadSchema } from "@/lib/content/guide-schema";
import { CALLOUT_TONES, contentBlockSchema } from "@/lib/content/schema";
import { articlePayloadSchema } from "./article-schema";
import { EXAMPLE_ARTICLE, EXAMPLE_GUIDE } from "./examples";
import { articleJsonSchema, guideJsonSchema, openApiDocument } from "./openapi";

const ROBOS_MD = fileURLToPath(new URL("../../../../docs/robos.md", import.meta.url));

/** The ```json blocks of docs/robos.md that follow a `<!-- exemplo:NAME -->` marker. */
function markdownExample(name: string): unknown {
  // Git on Windows (core.autocrlf) checks the doc out with CRLF line endings.
  const md = readFileSync(ROBOS_MD, "utf8").replace(/\r\n/g, "\n");
  const match = new RegExp(`<!-- exemplo:${name} -->\\s*\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(md);
  if (!match) throw new Error(`docs/robos.md has no example "${name}"`);
  return JSON.parse(match[1]);
}

describe("documented examples", () => {
  it("the article example uses every block type and every callout tone, and validates", () => {
    const types = new Set(EXAMPLE_ARTICLE.blocks.map((b) => b.type));
    expect([...types].sort()).toEqual([...contentBlockSchema.options.map((o) => o.shape.type.value)].sort());
    const tones = EXAMPLE_ARTICLE.blocks.flatMap((b) => (b.type === "callout" ? [b.tone] : []));
    expect(tones.sort()).toEqual([...CALLOUT_TONES].sort());
    expect(articlePayloadSchema.safeParse(EXAMPLE_ARTICLE).success).toBe(true);
  });

  it("the guide example fills every field and validates", () => {
    expect(guidePayloadSchema.safeParse(EXAMPLE_GUIDE).success).toBe(true);
    expect(Object.keys(EXAMPLE_GUIDE).sort()).toEqual(
      Object.keys(guidePayloadSchema.shape)
        .filter((k) => k !== "status")
        .sort(),
    );
  });

  it("docs/robos.md carries the same payloads", () => {
    expect(markdownExample("noticia")).toEqual(EXAMPLE_ARTICLE);
    expect(markdownExample("guia")).toEqual(EXAMPLE_GUIDE);
  });
});

describe("JSON Schema and OpenAPI exports", () => {
  it("export strict schemas with the required fields", () => {
    const article = articleJsonSchema();
    expect(article).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "/api/v1/schemas/article.json",
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["title", "category", "blocks"]),
    });
    const guide = guideJsonSchema();
    expect(guide).toMatchObject({ additionalProperties: false, required: expect.arrayContaining(["game", "facts", "steps"]) });
    expect(JSON.stringify(guide)).toContain('"minProperties":1');
    // Image URLs must be https; source links may be http(s).
    expect(JSON.stringify(article)).toContain('"pattern":"^https://"');
    expect(JSON.stringify(guide)).toContain('"pattern":"^https?://"');
  });

  it("describes every endpoint in OpenAPI 3.1", () => {
    const doc = openApiDocument() as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/v1/articles",
      "/api/v1/articles/{id}",
      "/api/v1/games",
      "/api/v1/games/{slug}/dossie",
      "/api/v1/games/{slug}/insights",
      "/api/v1/guides",
      "/api/v1/guides/{id}",
    ]);
    expect(Object.keys(doc.paths["/api/v1/articles/{id}"]).sort()).toEqual(["get", "patch"]);
  });
});
