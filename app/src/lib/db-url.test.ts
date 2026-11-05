import { describe, expect, it } from "vitest";
import { explicitSslMode } from "./db-url";

describe("explicitSslMode", () => {
  it("spells out verify-full for the modes pg already treats as verify-full", () => {
    for (const mode of ["prefer", "require", "verify-ca"]) {
      const out = explicitSslMode(`postgresql://u:p@ep-x.neon.tech/neondb?sslmode=${mode}&channel_binding=require`);
      const url = new URL(out);
      expect(url.searchParams.get("sslmode")).toBe("verify-full");
      expect(url.searchParams.get("channel_binding")).toBe("require");
      expect(url.username).toBe("u");
      expect(url.password).toBe("p");
      expect(url.pathname).toBe("/neondb");
    }
  });

  it("leaves other URLs as they are", () => {
    const local = "postgresql://gamelog:gamelog@localhost:5433/gamelog_test";
    expect(explicitSslMode(local)).toBe(local);
    const disabled = "postgresql://u:p@h/db?sslmode=disable";
    expect(explicitSslMode(disabled)).toBe(disabled);
    const libpq = "postgresql://u:p@h/db?uselibpqcompat=true&sslmode=require";
    expect(explicitSslMode(libpq)).toBe(libpq);
    expect(explicitSslMode("not a url")).toBe("not a url");
  });
});
