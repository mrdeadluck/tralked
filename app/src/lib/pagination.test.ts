import { describe, expect, it } from "vitest";
import { hrefWith, pageItems, pageWindow, paginate, parsePagination, pickParams } from "./pagination";

describe("parsePagination", () => {
  it("defaults to page 1 and 40 per page", () => {
    expect(parsePagination({})).toEqual({ page: 1, perPage: 40 });
  });

  it("accepts only 10, 20, 40 and 80 per page and whole pages from 1", () => {
    expect(parsePagination({ pagina: "3", por: "80" })).toEqual({ page: 3, perPage: 80 });
    expect(parsePagination({ pagina: "0", por: "33" })).toEqual({ page: 1, perPage: 40 });
    expect(parsePagination({ pagina: "-2", por: "10" })).toEqual({ page: 1, perPage: 10 });
    expect(parsePagination({ pagina: "2.5", por: "abc" })).toEqual({ page: 1, perPage: 40 });
    expect(parsePagination({ pagina: ["4", "9"], por: ["20"] })).toEqual({ page: 4, perPage: 20 });
  });
});

describe("pageWindow / paginate", () => {
  it("clamps a page past the end to the last page", () => {
    expect(pageWindow(9, 40, 531)).toMatchObject({ page: 9, totalPages: 14, offset: 320 });
    expect(pageWindow(99, 40, 531)).toMatchObject({ page: 14, offset: 520 });
  });

  it("keeps page 1 for an empty list", () => {
    expect(pageWindow(5, 10, 0)).toMatchObject({ page: 1, totalPages: 1, offset: 0 });
  });

  it("slices in-memory lists", () => {
    const list = Array.from({ length: 25 }, (_, i) => i);
    expect(paginate(list, 3, 10).items).toEqual([20, 21, 22, 23, 24]);
    expect(paginate(list, 1, 10)).toMatchObject({ total: 25, totalPages: 3 });
  });
});

describe("pageItems", () => {
  it("lists every page when they fit", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("uses ellipses around the current page and keeps first and last", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });

  it("never hides a single page behind an ellipsis and keeps a constant width", () => {
    for (let total = 8; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        const items = pageItems(page, total);
        expect(items).toHaveLength(7);
        expect(items).toContain(page);
        items.forEach((item, i) => {
          if (item !== "gap") return;
          const before = items[i - 1] as number;
          const after = items[i + 1] as number;
          expect(after - before).toBeGreaterThan(2);
        });
      }
    }
  });
});

describe("hrefWith / pickParams", () => {
  it("keeps filters, drops empty values, page 1 and the default page size", () => {
    expect(hrefWith("/jogos", { q: "zelda", plataforma: "PC" }, { pagina: 2 })).toBe(
      "/jogos?q=zelda&plataforma=PC&pagina=2",
    );
    expect(hrefWith("/jogos", { q: "zelda", pagina: "3", por: "20" }, { pagina: 1, por: 40 })).toBe("/jogos?q=zelda");
    expect(hrefWith("/jogos", { q: "" })).toBe("/jogos");
    expect(hrefWith("/jogos", { genero: "soulslike" }, { genero: undefined })).toBe("/jogos");
  });

  it("encodes values", () => {
    expect(hrefWith("/familia", { q: "baldur's gate & co" })).toBe("/familia?q=baldur%27s+gate+%26+co");
  });

  it("picks known keys, first value, trimmed", () => {
    expect(pickParams({ q: [" hades ", "x"], other: "1", ordem: "" }, ["q", "ordem"])).toEqual({ q: "hades" });
  });
});
