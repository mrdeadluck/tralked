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
