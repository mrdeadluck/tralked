import { describe, expect, it } from "vitest";
import { timeTo100From, timeTo100Label } from "./time-to-100";

describe("time to 100% (game page and guide)", () => {
  it("is the median of Tralked players when there are any, else IGDB, else nothing", () => {
    expect(timeTo100From([3000, 4800, 6000], 9000)).toEqual({ minutes: 4800, source: "tralked", players: 3 });
    expect(timeTo100From([], 6000)).toEqual({ minutes: 6000, source: "igdb", players: 0 });
    expect(timeTo100From([], null)).toBeNull();
  });

  it("always says where the number comes from", () => {
    expect(timeTo100Label({ minutes: 3000, source: "tralked", players: 2 })).toEqual({
      value: "50 h",
      source: "mediana de 2 jogadores do Tralked",
    });
    expect(timeTo100Label({ minutes: 3000, source: "tralked", players: 1 }).source).toBe("1 jogador do Tralked");
    expect(timeTo100Label({ minutes: 20, source: "igdb", players: 0 })).toEqual({ value: "1 h", source: "estimativa IGDB" });
  });
});
