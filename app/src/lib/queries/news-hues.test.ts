import { describe, expect, it } from "vitest";
import { artHues } from "./news";
import { hueFor } from "@/components/community/PhotoArt";

// Slugs that are also Object.prototype keys (a real game is "constructor") used to return a
// function, which then broke the RSC payload of /jogos ("Functions cannot be passed directly").
const PROTO_SLUGS = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

describe("art hues for prototype-named slugs", () => {
  it.each(PROTO_SLUGS)("artHues(%s) is a pair of numbers", (slug) => {
    const hues = artHues(slug, slug);
    expect(Array.isArray(hues)).toBe(true);
    expect(hues).toHaveLength(2);
    expect(hues.every((h) => typeof h === "number")).toBe(true);
  });

  it.each(PROTO_SLUGS)("hueFor(%s) is a pair of numbers", (slug) => {
    const hues = hueFor(slug);
    expect(hues).toHaveLength(2);
    expect(hues.every((h) => typeof h === "number")).toBe(true);
  });
});
