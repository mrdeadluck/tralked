import { describe, expect, it } from "vitest";
import {
  carismaPoints,
  helpfulReward,
  helpfulSourceKey,
  isCollapsed,
  likerOf,
  likeReward,
  likeSourceKey,
} from "./social";

const base = { receiverId: "b", actorId: "a", receiverToday: 0, pairToday: 0 };

describe("likeReward", () => {
  it("pays the receiver of a like from someone else", () => {
    expect(likeReward(base)).toEqual({ pay: true });
  });

  it("never pays a self-like or a deleted author", () => {
    expect(likeReward({ ...base, receiverId: "a" })).toEqual({ pay: false, reason: "self" });
    expect(likeReward({ ...base, receiverId: null })).toEqual({ pay: false, reason: "no_receiver" });
  });

  it("stops at 10 paid likes per receiver per day", () => {
    expect(likeReward({ ...base, receiverToday: 9 })).toEqual({ pay: true });
    expect(likeReward({ ...base, receiverToday: 10 })).toEqual({ pay: false, reason: "daily_cap" });
  });

  it("stops a pair after 3 paid likes a day (both directions together)", () => {
    expect(likeReward({ ...base, pairToday: 2 })).toEqual({ pay: true });
    expect(likeReward({ ...base, pairToday: 3 })).toEqual({ pay: false, reason: "pair_cap" });
  });
});

describe("helpfulReward", () => {
  it("pays up to 3 a day per receiver and 1 per pair", () => {
    expect(helpfulReward(base)).toEqual({ pay: true });
    expect(helpfulReward({ ...base, pairToday: 1 })).toEqual({ pay: false, reason: "pair_cap" });
    expect(helpfulReward({ ...base, receiverToday: 3 })).toEqual({ pay: false, reason: "daily_cap" });
    expect(helpfulReward({ ...base, receiverId: "a" })).toEqual({ pay: false, reason: "self" });
  });
});

describe("source keys", () => {
  it("round-trips the liker of a like entry", () => {
    const key = likeSourceKey("comment", "c1", "user9");
    expect(key).toBe("comment:c1:user9");
    expect(likerOf(key)).toBe("user9");
    expect(helpfulSourceKey("post", "p1")).toBe("post:p1");
  });
});

describe("isCollapsed", () => {
  it("collapses at 5 more dislikes than likes", () => {
    expect(isCollapsed(0, 4)).toBe(false);
    expect(isCollapsed(0, 5)).toBe(true);
    expect(isCollapsed(3, 7)).toBe(false);
    expect(isCollapsed(3, 8)).toBe(true);
  });
});

describe("carismaPoints", () => {
  it("adds likes, helpful replies and friends (at most 50)", () => {
    expect(carismaPoints(0, 0, 0)).toBe(0);
    expect(carismaPoints(4, 1, 2)).toBe(4 * 5 + 25 + 20);
    expect(carismaPoints(0, 0, 80)).toBe(500);
    expect(carismaPoints(-3, Number.NaN, 1)).toBe(10);
  });
});
