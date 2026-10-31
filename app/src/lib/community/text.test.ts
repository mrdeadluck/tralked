import { describe, expect, it } from "vitest";
import {
  captionSchema,
  commentBodySchema,
  containsHtml,
  linkify,
  slugify,
  threadTitleSchema,
} from "./text";

describe("community text", () => {
  it("rejects empty, whitespace-only and over-long comments", () => {
    expect(commentBodySchema.safeParse("").success).toBe(false);
    expect(commentBodySchema.safeParse("   \n\n ").success).toBe(false);
    expect(commentBodySchema.safeParse("a".repeat(2001)).success).toBe(false);
    expect(commentBodySchema.safeParse("a".repeat(2000)).success).toBe(true);
  });

  it("rejects HTML but keeps a plain '<'", () => {
    for (const body of ["<b>oi</b>", "olá <script>alert(1)</script>", '<img src=x onerror="x">', "<!-- x -->", "</p>"]) {
      expect(containsHtml(body)).toBe(true);
      const result = commentBodySchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/HTML/);
    }
    expect(commentBodySchema.safeParse("nível < 5 e eu <3 esse jogo").success).toBe(true);
  });

  it("trims and collapses blank lines", () => {
    expect(commentBodySchema.parse("  oi\r\n\r\n\r\n\r\ntchau  ")).toBe("oi\n\ntchau");
  });

  it("requires a thread title of 5 to 120 characters and an HTML-free caption", () => {
    expect(threadTitleSchema.safeParse("Oi").success).toBe(false);
    expect(threadTitleSchema.safeParse("Ritual ou Banishment?").success).toBe(true);
    expect(captionSchema.safeParse("<i>x</i>").success).toBe(false);
    expect(captionSchema.safeParse("").success).toBe(true);
  });

  it("links only http(s) URLs and leaves trailing punctuation out", () => {
    expect(linkify("veja https://example.com/a?b=1, e javascript:alert(1).")).toEqual([
      { kind: "text", text: "veja " },
      { kind: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { kind: "text", text: ", e javascript:alert(1)." },
    ]);
    expect(linkify("sem links")).toEqual([{ kind: "text", text: "sem links" }]);
  });

  it("slugifies titles", () => {
    expect(slugify("Ritual ou Banishment primeiro?")).toBe("ritual-ou-banishment-primeiro");
    expect(slugify("Ação & Coração")).toBe("acao-coracao");
    expect(slugify("???")).toBe("topico");
  });
});
