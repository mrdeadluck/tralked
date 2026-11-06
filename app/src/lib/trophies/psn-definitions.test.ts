import { describe, expect, it } from "vitest";
import { definitionsProblem, iconListId, sameTierCounts, tierCounts } from "./psn-definitions";

const icon = (list: string) => `https://image.api.playstation.com/trophy/np/${list}_00BB444E010D01F28F108EDD4A48BA5A88C986646B/08FBE167E4.PNG`;
const trophy = (tier: "bronze" | "silver" | "gold" | "platinum", iconUrl: string | null = icon("NPWR09510_00")) => ({ tier, iconUrl });

describe("tierCounts", () => {
  it("counts rows by tier (rows without a tier are left out)", () => {
    expect(tierCounts([{ trophyTier: "bronze" }, { trophyTier: "gold" }, { trophyTier: "bronze" }, { trophyTier: null }])).toEqual({
      bronze: 2,
      silver: 0,
      gold: 1,
      platinum: 0,
    });
  });

  it("sameTierCounts compares every tier", () => {
    const a = { bronze: 1, silver: 0, gold: 0, platinum: 0 };
    expect(sameTierCounts(a, { ...a })).toBe(true);
    expect(sameTierCounts(a, { ...a, platinum: 1 })).toBe(false);
  });
});

describe("iconListId", () => {
  it("reads the list id of PS4 and PS5 icon URLs", () => {
    expect(iconListId(icon("NPWR14350_00"))).toBe("NPWR14350_00");
    expect(iconListId("https://psnobj.prod.dl.playstation.net/psnobj/NPWR19950_00/07114e8c-3c4a.png")).toBe("NPWR19950_00");
  });

  it("is null for URLs without a list id and for no URL", () => {
    expect(iconListId("https://example.com/icon.png")).toBeNull();
    expect(iconListId(null)).toBeNull();
  });
});

describe("definitionsProblem", () => {
  const defined = { bronze: 2, silver: 1, gold: 0, platinum: 0 };

  it("accepts an answer that matches the defined counts and names the list in its icons", () => {
    expect(definitionsProblem("NPWR09510_00", defined, [trophy("bronze"), trophy("bronze"), trophy("silver")])).toBeNull();
  });

  it("rejects another count or other tiers", () => {
    expect(definitionsProblem("NPWR09510_00", defined, [trophy("bronze"), trophy("silver")])).toMatch(/2 trophies.*defines 3/);
    expect(definitionsProblem("NPWR09510_00", defined, [trophy("bronze"), trophy("gold"), trophy("silver")])).toMatch(/1 gold/);
  });

  it("rejects icons of another list (the Guns, Gore and Cannoli case)", () => {
    const answer = [trophy("bronze", icon("NPWR14350_00")), trophy("bronze", icon("NPWR14350_00")), trophy("silver", icon("NPWR14350_00"))];
    expect(definitionsProblem("NPWR09510_00", defined, answer)).toMatch(/icons of NPWR14350_00/);
  });

  it("does not fail icons without a list id, nor counts that are unknown (all zero or null)", () => {
    const answer = [trophy("bronze", null), trophy("gold", "https://example.com/x.png")];
    expect(definitionsProblem("NPWR09510_00", null, answer)).toBeNull();
    expect(definitionsProblem("NPWR09510_00", { bronze: 0, silver: 0, gold: 0, platinum: 0 }, answer)).toBeNull();
  });
});
