import { describe, expect, it } from "vitest";
import { contentHash, normalizeUrl } from "../src/url.js";

describe("normalizeUrl", () => {
  it("lowercases host, drops tracking params and hash, strips trailing slash", () => {
    expect(normalizeUrl("https://IGN.com/a/?utm_source=x#c")).toBe("https://ign.com/a");
  });

  it("drops fbclid and gclid but keeps other params", () => {
    expect(normalizeUrl("https://ign.com/a?id=3&fbclid=z&gclid=y&utm_medium=m")).toBe(
      "https://ign.com/a?id=3",
    );
  });

  it("keeps the root slash", () => {
    expect(normalizeUrl("https://IGN.com/")).toBe("https://ign.com/");
    expect(normalizeUrl("https://IGN.com")).toBe("https://ign.com/");
  });

  it("keeps the path case", () => {
    expect(normalizeUrl("https://ign.com/Games/Foo")).toBe("https://ign.com/Games/Foo");
  });
});

describe("contentHash", () => {
  it("ignores case and whitespace differences", () => {
    expect(contentHash("Hello   World\n")).toBe(contentHash("hello world"));
  });

  it("differs for different text and is a sha256 hex digest", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
