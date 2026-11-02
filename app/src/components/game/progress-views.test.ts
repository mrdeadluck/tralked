import { describe, expect, it } from "vitest";
import { catalogPlatforms, platformProgress, splitByPlatform, type GameUserProfile } from "@/lib/queries/game-profile";
import { steamPlayersNote } from "./BookletSpread";
import { catalogViews, progressViews } from "./progress-views";

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
    expect(psn).toMatchObject({ completed: true, pct: 100, platLabel: "TRALKED! · 40/40", detail: "conquistas na PSN · 100% · Tralked!" });
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
    expect(split?.views[0].detail).toContain("tudo Tralked!");
    // Steam and Xbox have no platinum trophy: theirs is the Tralked one; "Todas" pools both kinds.
    expect(split?.views.map((v) => v.tralkedPlatinum)).toEqual([undefined, true, true]);
  });
});

describe("catalogViews (the game's own numbers)", () => {
  it("shows the Tralked platinum apart: gold + silver + bronze are the platform's achievements", () => {
    const rows = [
      ...Array.from({ length: 63 }, () => ({ platform: "steam", globalPct: 50, trophyTier: null })),
      { platform: "psn", globalPct: null, trophyTier: "platinum" },
      { platform: "psn", globalPct: null, trophyTier: "gold" },
    ];
    const platforms = catalogPlatforms(rows, 63);
    const { views } = catalogViews(platforms, platforms[0], { link: { href: "/entrar", label: "entre" } });
    const [steam, psn] = views;
    expect(steam.total).toBe(63);
    expect(steam.trophies.platinum).toBe("+1");
    expect(steam.tralkedPlatinum).toBe(true);
    expect(Number(steam.trophies.gold) + Number(steam.trophies.silver) + Number(steam.trophies.bronze)).toBe(63);
    expect(psn.trophies.platinum).toBe("1");
    expect(psn.tralkedPlatinum).toBe(false);
  });
});

describe("steamPlayersNote", () => {
  it("never repeats a number already shown", () => {
    expect(steamPlayersNote({ current: 3972, todayPeak: 3972, allTimePeak: 3972 })).toBe("o maior pico medido");
    expect(steamPlayersNote({ current: 3000, todayPeak: 3000, allTimePeak: 5000 })).toBe("pico de hoje · maior pico medido 5.000");
    expect(steamPlayersNote({ current: 3000, todayPeak: 4000, allTimePeak: 4000 })).toBe("pico hoje 4.000, o maior medido");
    expect(steamPlayersNote({ current: 3000, todayPeak: 4000, allTimePeak: 5000 })).toBe("pico hoje 4.000 · maior pico medido 5.000");
    expect(steamPlayersNote({ current: 3000, todayPeak: null, allTimePeak: 5000 })).toBe("maior pico medido 5.000");
  });
});
