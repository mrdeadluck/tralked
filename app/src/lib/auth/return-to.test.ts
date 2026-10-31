import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  it("keeps same-origin relative paths", () => {
    expect(sanitizeReturnTo("/jogos/hollow-knight?tab=guias")).toBe(
      "/jogos/hollow-knight?tab=guias",
    );
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  it.each([
    null,
    undefined,
    "",
    "jogos",
    "//evil.example.com",
    "/\\evil.example.com",
    "https://evil.example.com",
    "javascript:alert(1)",
    "/ok\nSet-Cookie: x=1",
  ])("falls back to the default for %j", (value) => {
    expect(sanitizeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
  });

  it("defaults to /jogador/me", () => {
    expect(DEFAULT_RETURN_TO).toBe("/jogador/me");
  });
});
