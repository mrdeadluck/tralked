import { describe, expect, it } from "vitest";
import { applyReaction, nextReaction, reactionXpPlan, reactSchema } from "./reaction-rules";

describe("nextReaction", () => {
  it("toggles the same button and switches between like and dislike", () => {
    expect(nextReaction(0, 1)).toBe(1);
    expect(nextReaction(1, 1)).toBe(0);
    expect(nextReaction(1, -1)).toBe(-1);
    expect(nextReaction(-1, -1)).toBe(0);
    expect(nextReaction(-1, 1)).toBe(1);
  });
});

describe("applyReaction", () => {
  it("moves one count between likes and dislikes, never below zero", () => {
    expect(applyReaction({ likes: 2, dislikes: 1 }, 0, 1)).toEqual({ likes: 3, dislikes: 1 });
    expect(applyReaction({ likes: 3, dislikes: 1 }, 1, -1)).toEqual({ likes: 2, dislikes: 2 });
    expect(applyReaction({ likes: 2, dislikes: 2 }, -1, 0)).toEqual({ likes: 2, dislikes: 1 });
    expect(applyReaction({ likes: 0, dislikes: 0 }, 1, 0)).toEqual({ likes: 0, dislikes: 0 });
  });
});

describe("reactionXpPlan", () => {
  it("a like pays the reactor and the author", () => {
    expect(reactionXpPlan({ reactorId: "a", ownerId: "b", value: 1 })).toEqual({ giver: true, receiverId: "b" });
  });

  it("a dislike pays only the reactor", () => {
    expect(reactionXpPlan({ reactorId: "a", ownerId: "b", value: -1 })).toEqual({ giver: true, receiverId: null });
  });

  it("content without an author (robot articles, removed accounts) pays only the reactor", () => {
    expect(reactionXpPlan({ reactorId: "a", ownerId: null, value: 1 })).toEqual({ giver: true, receiverId: null });
  });

  it("reacting to your own content, or removing a reaction, pays nobody", () => {
    expect(reactionXpPlan({ reactorId: "a", ownerId: "a", value: 1 })).toEqual({ giver: false, receiverId: null });
    expect(reactionXpPlan({ reactorId: "a", ownerId: "a", value: -1 })).toEqual({ giver: false, receiverId: null });
    expect(reactionXpPlan({ reactorId: "a", ownerId: "b", value: 0 })).toEqual({ giver: false, receiverId: null });
  });
});

describe("reactSchema", () => {
  it("accepts only the four targets and the values 1 and -1", () => {
    expect(reactSchema.safeParse({ targetType: "guide", targetId: "g1", value: -1 }).success).toBe(true);
    expect(reactSchema.safeParse({ targetType: "thread", targetId: "t1", value: 1 }).success).toBe(false);
    expect(reactSchema.safeParse({ targetType: "photo", targetId: "p1", value: 0 }).success).toBe(false);
    expect(reactSchema.safeParse({ targetType: "photo", targetId: "", value: 1 }).success).toBe(false);
  });
});
