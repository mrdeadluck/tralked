import { describe, expect, it } from "vitest";
import { isSafeHref, isSafeHttpUrl, isSiteRelativePath } from "./url";

describe("URL guards", () => {
  it("accepts only absolute http(s) URLs", () => {
    expect(isSafeHttpUrl("https://example.com/a")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "//evil.example.com/x",
      "/noticias/x",
      "ftp://example.com",
      "",
    ]) {
      expect(isSafeHttpUrl(bad), bad).toBe(false);
    }
  });

  it("site paths must not be protocol-relative", () => {
    expect(isSiteRelativePath("/noticias/x")).toBe(true);
    expect(isSiteRelativePath("//evil.example.com")).toBe(false);
    expect(isSiteRelativePath("/\\evil.example.com")).toBe(false);
    expect(isSiteRelativePath("javascript:alert(1)")).toBe(false);
  });

  it("isSafeHref checks external links as http(s) and internal ones as site paths", () => {
    expect(isSafeHref("https://example.com", true)).toBe(true);
    expect(isSafeHref("javascript:alert(1)", true)).toBe(false);
    expect(isSafeHref("/noticias/a", false)).toBe(true);
    expect(isSafeHref("https://example.com", false)).toBe(false);
    expect(isSafeHref("javascript:alert(1)", undefined)).toBe(false);
  });
});
