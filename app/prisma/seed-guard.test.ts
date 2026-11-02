import { describe, expect, it } from "vitest";
import { seedTargetError } from "./seed-guard";

describe("seedTargetError", () => {
  it("allows local databases and the missing-URL fallback", () => {
    expect(seedTargetError(undefined, undefined)).toBeNull();
    expect(seedTargetError("postgresql://u:p@localhost:5433/gamelog_dev", undefined)).toBeNull();
    expect(seedTargetError("postgresql://u:p@127.0.0.1/gamelog", undefined)).toBeNull();
  });

  it("refuses a remote database unless explicitly allowed", () => {
    const neon = "postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/neondb?sslmode=require";
    expect(seedTargetError(neon, undefined)).toMatch(/Refusing to seed ep-x\.sa-east-1\.aws\.neon\.tech/);
    expect(seedTargetError(neon, "1")).toBeNull();
  });

  it("refuses an unparseable URL", () => {
    expect(seedTargetError("not a url", undefined)).toMatch(/not a valid URL/);
  });
});
