import { describe, expect, it } from "vitest";
import { pickBackdrops } from "./backdrops";

const game = (gameId: string, heroUrl: string | null, coverUrl: string | null = null) => ({
  gameId,
  art: { heroUrl, coverUrl },
});

describe("pickBackdrops", () => {
  it("takes the wide art of the last three games played, newest first, one per game", () => {
    const recent = [
      game("pbz", "https://img/pbz-hero.jpg"),
      game("pbz", "https://img/pbz-hero.jpg"), // same game on another platform
      game("cv", "https://img/cv-hero.jpg"),
      game("fc", "https://img/fc-hero.jpg"),
      game("gow", "https://img/gow-hero.jpg"),
    ];
    expect(pickBackdrops(recent, [])).toEqual([
      "https://img/pbz-hero.jpg",
      "https://img/cv-hero.jpg",
      "https://img/fc-hero.jpg",
    ]);
  });

  it("skips games without wide art and completes with the most played", () => {
    const recent = [game("demo", null, "https://img/demo-cover.jpg"), game("cv", "https://img/cv-hero.jpg")];
    const played = [game("cv", "https://img/cv-hero.jpg"), game("tlou", "https://img/tlou-hero.jpg"), game("re4", "https://img/re4-hero.jpg")];
    expect(pickBackdrops(recent, played)).toEqual([
      "https://img/cv-hero.jpg",
      "https://img/tlou-hero.jpg",
      "https://img/re4-hero.jpg",
    ]);
  });

  it("falls back to the most played game's cover when no game has wide art, and to nothing at all", () => {
    expect(pickBackdrops([], [game("old", null, "https://img/old-cover.jpg")])).toEqual(["https://img/old-cover.jpg"]);
    expect(pickBackdrops([], [])).toEqual([]);
  });
});
