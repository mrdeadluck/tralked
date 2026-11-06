import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyFromFiles, parseKeys } from "./keys";

describe("parseKeys", () => {
  it("reads KEY=value lines, skipping comments and blanks and removing quotes", () => {
    const keys = parseKeys('﻿PSN_FIRST=1\r\n# comment\r\nPSN_NPSSO=abc=def\n\nXBOX_OPENXBL_KEY="quoted"\nexport RA_API_KEY=\'x\'\nEMPTY=\nnot a line\n');
    expect([...keys]).toEqual([
      ["PSN_FIRST", "1"],
      ["PSN_NPSSO", "abc=def"],
      ["XBOX_OPENXBL_KEY", "quoted"],
      ["RA_API_KEY", "x"],
    ]);
  });
});

describe("keyFromFiles", () => {
  it("takes the first file that has the key (missing files and empty values skipped), or null", () => {
    const dir = mkdtempSync(join(tmpdir(), "keys-"));
    try {
      const chaves = join(dir, ".env.chaves");
      const prod = join(dir, ".env.production.local");
      writeFileSync(prod, 'STEAM_API_KEY="from-prod"\n');
      writeFileSync(chaves, "STEAM_API_KEY=\nOTHER=1\n");
      expect(keyFromFiles("STEAM_API_KEY", [join(dir, "missing"), chaves, prod])).toEqual({ value: "from-prod", file: prod });
      writeFileSync(chaves, "STEAM_API_KEY=from-chaves\n");
      expect(keyFromFiles("STEAM_API_KEY", [chaves, prod])).toEqual({ value: "from-chaves", file: chaves });
      expect(keyFromFiles("NOPE", [chaves, prod])).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
