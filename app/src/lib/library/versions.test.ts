import { describe, expect, it } from "vitest";
import { libraryVersions } from "./versions";

const done = new Date(Date.UTC(2026, 10, 5));

describe("libraryVersions, the Steam version", () => {
  it("a finished Steam game (completedAt) shows the check", () => {
    const [steam] = libraryVersions([{ platform: "steam", unlockedCount: 77, achievementTotal: 77, completedAt: done }], []);
    expect(steam).toMatchObject({ key: "steam", pct: 100, platinum: true });
  });

  it("a tainted 100% (no completedAt) shows its percentage without the check", () => {
    const [steam] = libraryVersions([{ platform: "steam", unlockedCount: 77, achievementTotal: 77, completedAt: null }], []);
    expect(steam).toMatchObject({ key: "steam", pct: 100, platinum: false });
  });
});

describe("libraryVersions, an Xbox list", () => {
  it("at the base game's 1000G shows the check, DLC missing (Tralked)", () => {
    const list = { platform: "xbox", console: "ONE", externalId: "123", unlockedCount: 40, completedAt: null, total: 50, platinumEarned: false };
    const [at1000] = libraryVersions([], [{ ...list, gamerscore: 1000 }]);
    expect(at1000).toMatchObject({ key: "xbox:123", pct: 80, platinum: true, regions: 1 });
    const [below] = libraryVersions([], [{ ...list, gamerscore: 990 }]);
    expect(below).toMatchObject({ platinum: false, regions: 0 });
  });
});
