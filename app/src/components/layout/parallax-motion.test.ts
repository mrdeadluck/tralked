import { describe, expect, it } from "vitest";
import { END_STAGE, backdropModeFor, figurePose, markPulses, ribbonForSlot, ribbonPose, ribbonStage, stagePixels } from "./parallax-motion";

describe("backdropModeFor", () => {
  it("shows the cast on Home, Notícias and the Comunidade pages", () => {
    for (const path of ["/", "/noticias", "/forum", "/forum/ajuda", "/galeria", "/familia"]) {
      expect(backdropModeFor(path)).toBe("full");
    }
  });
  it("leaves the characters out everywhere else", () => {
    for (const path of ["/noticias/um-artigo", "/jogos", "/jogador/diguzz", "/highscores", "/forumx", "/admin"]) {
      expect(backdropModeFor(path)).toBe("ribbons");
    }
  });
});

describe("stagePixels", () => {
  it("uses a fixed slice of the viewport, whatever the page length", () => {
    expect(stagePixels(1000, false, "ribbons", 300)).toBe(900);
    expect(stagePixels(1000, false, "ribbons", 50_000)).toBe(900);
    expect(stagePixels(800, true, "ribbons", 50_000)).toBeCloseTo(1280);
  });
  it("lets a short page with the cast still reach the last character, without flashing", () => {
    expect(stagePixels(1000, false, "full", 3150)).toBe(600);
    expect(stagePixels(1000, false, "full", 50_000)).toBe(900);
    expect(stagePixels(1000, false, "full", 200)).toBe(500);
  });
});

describe("ribbons", () => {
  it("peak at the preview's stages, then every 1.3 stages", () => {
    expect([0, 1, 2, 3, 4, 5].map(ribbonStage).map((s) => +s.toFixed(2))).toEqual([0, 1.25, 2.55, 3.85, 5.15, 6.45]);
  });
  it("never leave a long page empty: some ribbon is always on its way", () => {
    for (let t = 0; t < 40; t += 0.05) {
      const best = Math.max(ribbonPose(t, ribbonForSlot(t, 0), false).opacity, ribbonPose(t, ribbonForSlot(t, 1), false).opacity);
      expect(best).toBeGreaterThan(0.05);
    }
  });
  it("alternate the tilt like the preview", () => {
    expect(ribbonPose(0, 0, false).transform).toContain("rotate(-13deg)");
    expect(ribbonPose(1.25, 1, false).transform).toContain("rotate(13deg)");
    expect(ribbonForSlot(1.25, 1)).toBe(1);
    expect(ribbonForSlot(2.55, 0)).toBe(2);
  });
});

describe("figurePose", () => {
  it("peaks at its center and is gone well past it", () => {
    const opts = { side: "left" as const, back: false, viewport: 900, mobile: false };
    expect(figurePose(END_STAGE, END_STAGE, opts).opacity).toBe(1);
    expect(figurePose(END_STAGE + 1.4, END_STAGE, opts).opacity).toBe(0);
  });
});

describe("markPulses", () => {
  it("keeps the preview's passages: word 0.65, emblem 1.95, word 3.25, emblem 4.55", () => {
    expect(markPulses(0.65)).toEqual({ word: 1, symbol: expect.any(Number) });
    expect(markPulses(1.95).symbol).toBe(1);
    expect(markPulses(3.25).word).toBe(1);
    expect(markPulses(4.55).symbol).toBe(1);
    expect(markPulses(0.65).symbol).toBeLessThan(0.01);
    expect(markPulses(1.3).word + markPulses(1.3).symbol).toBeLessThan(0.3);
  });
  it("keeps alternating after the cast, for long ribbon-only pages", () => {
    expect(markPulses(5.85).word).toBeCloseTo(1);
    expect(markPulses(7.15).symbol).toBeCloseTo(1);
    expect(markPulses(7.15).word).toBeLessThan(0.01);
  });
});
