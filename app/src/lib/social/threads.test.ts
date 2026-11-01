import { describe, expect, it } from "vitest";
import { parseMentions } from "./mentions";
import { buildTree, replyParentId } from "./threads";

describe("replyParentId", () => {
  it("answers roots and 1st-level replies directly, and 2nd-level replies as siblings", () => {
    expect(replyParentId("root", null, null)).toBe("root");
    expect(replyParentId("r1", "root", null)).toBe("r1");
    expect(replyParentId("r2", "r1", "root")).toBe("r1");
  });
});

describe("buildTree", () => {
  it("nests replies two levels deep and drops orphans", () => {
    const tree = buildTree([
      { id: "a", parentId: null },
      { id: "b", parentId: null },
      { id: "a1", parentId: "a" },
      { id: "a1x", parentId: "a1" },
      { id: "a1xy", parentId: "a1x" },
      { id: "orphan", parentId: "gone" },
    ]);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0].replies.map((n) => [n.id, n.depth])).toEqual([["a1", 1]]);
    expect(tree[0].replies[0].replies.map((n) => [n.id, n.depth])).toEqual([["a1x", 2]]);
    expect(tree[0].replies[0].replies[0].replies).toEqual([]);
  });

  it("keeps the given root order", () => {
    const tree = buildTree(
      [
        { id: "a", parentId: null },
        { id: "b", parentId: null },
      ],
      ["b", "a"],
    );
    expect(tree.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("parseMentions", () => {
  it("finds distinct handles, ignores e-mails and caps at 5", () => {
    expect(parseMentions("valeu @Lenhador_Bento e @lenhador_bento! fala@email.com")).toEqual(["lenhador_bento"]);
    expect(parseMentions("@aaa @bbb @ccc @ddd @eee @fff")).toEqual(["aaa", "bbb", "ccc", "ddd", "eee"]);
    expect(parseMentions("@ab é curto demais")).toEqual([]);
  });
});
