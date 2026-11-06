import { describe, expect, it } from "vitest";
import { groupPanels } from "./content-panels";

type Box = { left: number; right: number; top: number; bottom: number };

function page(html: string) {
  document.body.innerHTML = `<main id="principal">${html}</main>`;
  return document.getElementById("principal")!;
}
const $ = (id: string) => document.getElementById(id)!;
const row = (top: number, bottom: number, left = 0, right = 1000): Box => ({ left, right, top, bottom });

describe("groupPanels", () => {
  it("keeps blocks far apart as separate panels", () => {
    const root = page(`<div id="col"><section id="a"></section><section id="b"></section></div>`);
    const boxes: Record<string, Box> = { a: row(0, 100), b: row(148, 300), col: row(0, 300) };
    const panels = groupPanels(root, [$("a"), $("b")], (el) => boxes[el.id], () => true);
    expect(panels.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("merges blocks closer than two frames into their common parent", () => {
    const root = page(`<div id="col"><nav id="a"></nav><nav id="b"></nav><p id="c"></p></div><section id="far"></section>`);
    const boxes: Record<string, Box> = { a: row(0, 40), b: row(56, 90), c: row(106, 120), col: row(0, 120), far: row(400, 600) };
    const panels = groupPanels(root, [$("a"), $("b"), $("c"), $("far")], (el) => boxes[el.id], () => true);
    expect(panels.map((p) => p.id).sort()).toEqual(["col", "far"]);
  });

  it("never paints an ancestor that has a background of its own", () => {
    const root = page(`<div id="card"><nav id="a"></nav><nav id="b"></nav></div><section id="c"></section>`);
    const boxes: Record<string, Box> = { a: row(0, 40), b: row(50, 90), card: row(0, 90), c: row(300, 320) };
    const panels = groupPanels(root, [$("a"), $("b"), $("c")], (el) => boxes[el.id], (el) => el.id !== "card");
    expect(panels.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("frames the whole column when its loose blocks sit right on the page root", () => {
    const root = page(`<h1 id="t"></h1><form id="f"></form>`);
    const boxes: Record<string, Box> = { t: row(0, 40), f: row(52, 90) };
    const panels = groupPanels(root, [$("t"), $("f")], (el) => boxes[el.id], () => true);
    expect(panels).toEqual([root]);
  });

  it("keeps merging upward until no two panels touch", () => {
    const root = page(
      `<div id="page"><div id="top"><h1 id="t"></h1><p id="s"></p></div><div id="filters"><nav id="f1"></nav><nav id="f2"></nav></div></div>`,
    );
    const boxes: Record<string, Box> = {
      t: row(0, 40), s: row(50, 70), top: row(0, 70),
      f1: row(84, 120), f2: row(128, 160), filters: row(84, 160), page: row(0, 160),
    };
    const panels = groupPanels(root, [$("t"), $("s"), $("f1"), $("f2")], (el) => boxes[el.id], () => true);
    expect(panels.map((p) => p.id)).toEqual(["page"]);
  });
});
