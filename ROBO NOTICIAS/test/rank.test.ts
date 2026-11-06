import { describe, expect, it } from "vitest";
import { TIER_WEIGHT, isBomb, isExpired, isPublishable, storyScore } from "../src/rank.js";

const HOUR = 60 * 60 * 1000;

describe("TIER_WEIGHT", () => {
  it("weighs oficial 20, portal 10, outro 0", () => {
    expect(TIER_WEIGHT).toEqual({ oficial: 20, portal: 10, outro: 0 });
  });
});

describe("storyScore", () => {
  it("adds max importance and the highest tier weight for a single source", () => {
    expect(storyScore({ maxImportance: 50, tiers: ["outro"], sourceCount: 1, rumor: false })).toBe(50);
    expect(storyScore({ maxImportance: 50, tiers: ["portal"], sourceCount: 1, rumor: false })).toBe(60);
    expect(storyScore({ maxImportance: 50, tiers: ["outro", "oficial", "portal"], sourceCount: 1, rumor: false })).toBe(70);
  });

  it("adds 5 per extra source, capped at 7 extra sources (coverage is the engagement we can see)", () => {
    expect(storyScore({ maxImportance: 50, tiers: ["outro"], sourceCount: 2, rumor: false })).toBe(55);
    expect(storyScore({ maxImportance: 50, tiers: ["outro"], sourceCount: 5, rumor: false })).toBe(70);
    expect(storyScore({ maxImportance: 50, tiers: ["outro"], sourceCount: 8, rumor: false })).toBe(85);
    expect(storyScore({ maxImportance: 50, tiers: ["outro"], sourceCount: 12, rumor: false })).toBe(85);
  });

  it("subtracts 15 for a rumor", () => {
    expect(storyScore({ maxImportance: 80, tiers: ["portal", "outro"], sourceCount: 3, rumor: true })).toBe(80 + 10 + 10 - 15);
  });

  it("treats an empty tier list as weight 0 and never rewards a zero source count", () => {
    expect(storyScore({ maxImportance: 40, tiers: [], sourceCount: 0, rumor: false })).toBe(40);
  });
});

describe("isBomb", () => {
  it("needs importance >= 90, at least 3 sources and a non-outro source", () => {
    expect(isBomb({ maxImportance: 90, tiers: ["portal", "outro", "outro"], sourceCount: 3 })).toBe(true);
    expect(isBomb({ maxImportance: 99, tiers: ["oficial", "outro", "outro"], sourceCount: 5 })).toBe(true);
  });

  it("a rumor is never a bomb, and only sources with their own text count toward the 3 (review 06/11/2026)", () => {
    expect(isBomb({ maxImportance: 95, tiers: ["portal", "portal", "portal"], sourceCount: 3, rumor: true })).toBe(false);
    // One portal plus two Reddit hot lists (signal only) or title-only Google News items.
    expect(isBomb({ maxImportance: 95, tiers: ["portal", "outro", "outro"], sourceCount: 3, fullTextSources: 1 })).toBe(false);
    expect(isBomb({ maxImportance: 95, tiers: ["portal", "portal", "outro"], sourceCount: 4, fullTextSources: 3 })).toBe(true);
  });

  it("is not a bomb with only 2 sources, even at importance 100 with an oficial source", () => {
    expect(isBomb({ maxImportance: 100, tiers: ["oficial", "portal"], sourceCount: 2 })).toBe(false);
  });

  it("is not a bomb at importance 89", () => {
    expect(isBomb({ maxImportance: 89, tiers: ["oficial", "portal", "portal"], sourceCount: 3 })).toBe(false);
  });

  it("is not a bomb when every source is outro", () => {
    expect(isBomb({ maxImportance: 95, tiers: ["outro", "outro", "outro"], sourceCount: 3 })).toBe(false);
  });
});

describe("isPublishable", () => {
  const base = { rumor: false, hasFullText: true };

  it("publishes a single oficial source", () => {
    expect(isPublishable({ ...base, tiers: ["oficial"], sourceCount: 1 })).toBe(true);
  });

  it("publishes two sources of any tier", () => {
    expect(isPublishable({ ...base, tiers: ["outro", "outro"], sourceCount: 2 })).toBe(true);
  });

  it("publishes exactly one portal source when it is not a rumor", () => {
    expect(isPublishable({ ...base, tiers: ["portal"], sourceCount: 1 })).toBe(true);
    expect(isPublishable({ ...base, rumor: true, tiers: ["portal"], sourceCount: 1 })).toBe(false);
  });

  it("does not publish a single outro source", () => {
    expect(isPublishable({ ...base, tiers: ["outro"], sourceCount: 1 })).toBe(false);
  });

  it("does not publish a rumor whose only source is outro", () => {
    expect(isPublishable({ ...base, rumor: true, tiers: ["outro"], sourceCount: 1 })).toBe(false);
  });

  it("requires a portal or oficial source for a rumor, even with several sources", () => {
    expect(isPublishable({ ...base, rumor: true, tiers: ["outro", "outro", "outro"], sourceCount: 3 })).toBe(false);
    expect(isPublishable({ ...base, rumor: true, tiers: ["portal", "outro"], sourceCount: 2 })).toBe(true);
    expect(isPublishable({ ...base, rumor: true, tiers: ["oficial"], sourceCount: 1 })).toBe(true);
  });

  it("R15: a title-only oficial source with no full-text source is not publishable", () => {
    expect(isPublishable({ rumor: false, hasFullText: false, tiers: ["oficial"], sourceCount: 1 })).toBe(false);
    expect(isPublishable({ rumor: false, hasFullText: false, tiers: ["oficial", "portal", "outro"], sourceCount: 3 })).toBe(false);
  });

  it("R15: title-only sources still count once one source has full text", () => {
    // e.g. oficial via Google News (title only) + an outro with full text
    expect(isPublishable({ rumor: false, hasFullText: true, tiers: ["oficial", "outro"], sourceCount: 2 })).toBe(true);
  });
});

describe("isExpired", () => {
  const first = new Date("2026-10-30T12:00:00Z");
  const at = (h: number) => new Date(first.getTime() + h * HOUR);

  it("expires a story scoring below 70 after 24 h, not at exactly 24 h", () => {
    expect(isExpired({ score: 69, firstSeenAt: first }, at(23))).toBe(false);
    expect(isExpired({ score: 69, firstSeenAt: first }, at(24))).toBe(false);
    expect(isExpired({ score: 69, firstSeenAt: first }, new Date(at(24).getTime() + 1))).toBe(true);
  });

  it("keeps a story scoring 70 until 48 h", () => {
    expect(isExpired({ score: 70, firstSeenAt: first }, new Date(at(24).getTime() + 1))).toBe(false);
    expect(isExpired({ score: 70, firstSeenAt: first }, at(48))).toBe(false);
    expect(isExpired({ score: 70, firstSeenAt: first }, new Date(at(48).getTime() + 1))).toBe(true);
  });

  it("with a max age, expires every story past it, whatever the score (news of the day only)", () => {
    expect(isExpired({ score: 95, firstSeenAt: first }, at(12), 12)).toBe(false);
    expect(isExpired({ score: 95, firstSeenAt: first }, new Date(at(12).getTime() + 1), 12)).toBe(true);
    expect(isExpired({ score: 40, firstSeenAt: first }, new Date(at(12).getTime() + 1), 12)).toBe(true);
  });

  it("score 69 vs 70 at 30 h", () => {
    expect(isExpired({ score: 69, firstSeenAt: first }, at(30))).toBe(true);
    expect(isExpired({ score: 70, firstSeenAt: first }, at(30))).toBe(false);
  });
});
