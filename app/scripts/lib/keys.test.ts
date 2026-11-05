import { describe, expect, it } from "vitest";
import { parseKeys } from "./keys";

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
