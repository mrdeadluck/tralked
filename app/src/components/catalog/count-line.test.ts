import { describe, expect, it } from "vitest";
import { countLine, effectiveCuts } from "./count-line";

const off = { exclusive: false, withTrophies: false };

describe("countLine", () => {
  it("counts in pt-BR, singular for one", () => {
    expect(countLine({ total: 1102, ...off })).toBe("1.102 jogos");
    expect(countLine({ total: 1, ...off })).toBe("1 jogo");
    expect(countLine({ total: 0, ...off })).toBe("0 jogos");
  });

  it("names the cuts, as in the approved mockup", () => {
    expect(countLine({ total: 1102, platform: "PLAYSTATION", exclusive: true, withTrophies: true })).toBe(
      "1.102 jogos · exclusivos de PlayStation · com troféus",
    );
    expect(countLine({ total: 40, platform: "XBOX", ...off })).toBe("40 jogos · Xbox");
    expect(countLine({ total: 40, platform: "PC", exclusive: true, withTrophies: false })).toBe("40 jogos · exclusivos de PC");
  });

  it("exclusive without a platform says one platform only", () => {
    expect(countLine({ total: 9000, exclusive: true, withTrophies: false })).toBe("9.000 jogos · exclusivos de uma plataforma só");
    expect(countLine({ total: 9000, exclusive: true, withTrophies: true })).toBe("9.000 jogos · exclusivos de uma plataforma só · com troféus");
  });

  it("keeps the search term", () => {
    expect(countLine({ total: 3, q: "zelda", ...off })).toBe("3 jogos · para “zelda”");
  });
});

describe("effectiveCuts", () => {
  it("Retro drops exclusives, Nintendo drops trophies, the rest passes through", () => {
    expect(effectiveCuts("RETRO", true, true)).toEqual({ exclusive: false, withTrophies: true });
    expect(effectiveCuts("NINTENDO", true, true)).toEqual({ exclusive: true, withTrophies: false });
    expect(effectiveCuts("PC", true, false)).toEqual({ exclusive: true, withTrophies: false });
    expect(effectiveCuts(undefined, true, true)).toEqual({ exclusive: true, withTrophies: true });
  });
});
