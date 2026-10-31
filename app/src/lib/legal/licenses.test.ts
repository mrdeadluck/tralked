import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATA_SOURCES, FONTS, SOFTWARE } from "./licenses";

const PACKAGE_JSON = fileURLToPath(new URL("../../../package.json", import.meta.url));

describe("licenses page data", () => {
  it("lists every runtime dependency of package.json", () => {
    const { dependencies } = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { dependencies: Record<string, string> };
    const listed = new Set(SOFTWARE.flatMap((s) => (s.pkg ? [s.pkg] : [])));
    expect(Object.keys(dependencies).filter((name) => !listed.has(name))).toEqual([]);
  });

  it("links every entry over https", () => {
    for (const entry of [...SOFTWARE, ...FONTS, ...DATA_SOURCES]) {
      expect(entry.url, entry.name).toMatch(/^https:\/\//);
      expect(entry.license.length, entry.name).toBeGreaterThan(0);
    }
  });
});
