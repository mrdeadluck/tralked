import { describe, expect, it } from "vitest";
import { platformProgress, splitByPlatform, type GameUserProfile } from "@/lib/queries/game-profile";
import { progressViews } from "./progress-views";

function progressOf(rows: { platform: string; unlockedCount: number; completedAt: Date | null; total: number }[]) {
  const platforms = rows.map((r) => platformProgress({ ...r, playtimeMin: 60 }, r.total));
  const split = splitByPlatform(platforms, [{ platform: "psn", tier: "platinum" }]);
  const best = [...platforms].sort((a, b) => Number(b.completed) - Number(a.completed) || b.pct - a.pct)[0];
  return { platforms, best, ...split, playtimeMin: 120, completed: platforms.some((p) => p.completed) } satisfies NonNullable<
    GameUserProfile["progress"]
  >;
}

describe("progressViews (game page platform tabs)", () => {
  it("one platform: no tabs", () => {
    expect(progressViews(progressOf([{ platform: "steam", unlockedCount: 3, completedAt: null, total: 10 }]))).toBeNull();
  });

  it("Todas first, then each platform, starting on the one with the most progress", () => {
    const split = progressViews(
      progressOf([
        { platform: "steam", unlockedCount: 62, completedAt: null, total: 63 },
        { platform: "psn", unlockedCount: 40, completedAt: new Date(), total: 40 },
      ]),
    );
    expect(split?.initial).toBe("psn");
    expect(split?.views.map((v) => [v.id, v.label, v.badge])).toEqual([
      ["todas", "Todas", null],
      ["steam", "Steam", null],
      ["psn", "PSN", "Platina"],
    ]);
    const [all, steam, psn] = split!.views;
    expect(all).toMatchObject({ unlocked: 102, total: 103, pct: 99, completed: false });
    expect(all.detail).toBe("conquistas somadas de 2 plataformas · 99% no total · falta 1 no total");
    expect(steam.detail).toBe("conquistas na Steam · 98% · falta 1 para platinar");
    expect(steam.trophies.platinum).toBe("0/1");
    expect(psn).toMatchObject({ completed: true, pct: 100, platLabel: "PLATINADO · 40/40", detail: "conquistas na PSN · 100% · platinado" });
    expect(all.trophies.platinum).toBe("1/2");
  });

  it("a 100% without a platinum trophy reads 100%", () => {
    const split = progressViews(
      progressOf([
        { platform: "steam", unlockedCount: 10, completedAt: null, total: 10 },
        { platform: "xbox", unlockedCount: 5, completedAt: new Date(), total: 5 },
      ]),
    );
    expect(split?.views.map((v) => v.badge)).toEqual(["100%", "100%", "100%"]);
    expect(split?.views[0].detail).toContain("tudo platinado");
  });
});
