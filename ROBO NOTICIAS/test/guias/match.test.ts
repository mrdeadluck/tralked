import { describe, expect, it } from "vitest";
import { computeCompat, matchAchievements, normalizeName } from "../../src/guias/match.js";

const steam = [
  { apiName: "ACH_013", name: "With Heart and Blood", description: "Finish the game." },
  { apiName: "ACH_014", name: "Total Domination", description: "Collect 10 Amber of Sha-Chi" },
];

describe("matchAchievements", () => {
  it('"With Heart and Blood" casa com ACH_013', () => {
    const result = matchAchievements(steam, [{ nameEn: "With Heart and Blood" }]);
    expect(result).toEqual([
      { apiName: "ACH_013", matched: true },
      { apiName: "ACH_014", matched: false },
    ]);
  });

  it("ignora maiúsculas, pontuação, acento, & e aspas tipográficas", () => {
    expect(normalizeName("“With Heart & Blood”!")).toBe("with heart and blood");
    expect(normalizeName("Don’t Look Back")).toBe("dont look back");
    const result = matchAchievements(steam, [{ nameEn: "WITH HEART & BLOOD!" }]);
    expect(result[0]!.matched).toBe(true);
  });

  it("sem igualdade exata, exige nome >= 0.9 e descrição compatível", () => {
    const near = { nameEn: "Total Dominaton", description: "Collect 10 Amber of Sha-Chi" };
    expect(matchAchievements(steam, [near])[1]!.matched).toBe(true);
    expect(matchAchievements(steam, [{ ...near, description: "Defeat every boss" }])[1]!.matched).toBe(false);
    expect(matchAchievements(steam, [{ nameEn: near.nameEn }])[1]!.matched).toBe(false);
    expect(matchAchievements(steam, [{ ...near, nameEn: "Total Rule" }])[1]!.matched).toBe(false);
  });
});

describe("computeCompat", () => {
  it("steam 66, psn 36 → steam_only", () => {
    expect(computeCompat(66, [{ platform: "psn", matchedAll: true, size: 36 }])).toBe("steam_only");
    expect(computeCompat(66, [])).toBe("steam_only");
  });

  it("listas iguais psn+xbox → psn_xbox", () => {
    expect(
      computeCompat(66, [
        { platform: "psn", matchedAll: true, size: 66 },
        { platform: "xbox", matchedAll: true, size: 66 },
      ]),
    ).toBe("psn_xbox");
  });

  it("só uma plataforma igual → psn ou xbox; platina a mais é tolerada", () => {
    expect(computeCompat(66, [{ platform: "psn", matchedAll: true, size: 67 }])).toBe("psn");
    expect(computeCompat(66, [{ platform: "xbox", matchedAll: true, size: 66 }])).toBe("xbox");
    expect(computeCompat(66, [{ platform: "psn", matchedAll: false, size: 66 }])).toBe("steam_only");
  });
});
