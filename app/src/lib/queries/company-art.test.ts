import { describe, expect, it } from "vitest";
import { companiesIn, franchiseOf, galleryFor, pickIndex } from "./company-art";

describe("companiesIn", () => {
  it("finds the company a headline names, first match first", () => {
    expect(companiesIn("EA conclui venda para PIF, Silver Lake e Affinity")[0]).toEqual(["Electronic Arts"]);
    expect(companiesIn("Relatório: EA trocou Mass Effect por Star Wars Battlefront 3")[0]).toEqual(["Electronic Arts"]);
    expect(companiesIn("Ubisoft demite 200 pessoas")[0]).toEqual(["Ubisoft"]);
    expect(companiesIn("Take-Two fala sobre o GTA 6")[0]).toEqual(["Rockstar Games"]);
  });

  it("does not match words that only contain a company name", () => {
    expect(companiesIn("Ideias para o fim de semana")).toEqual([]);
    expect(companiesIn("Steamworks muda regras")).toEqual([]);
  });

  it("picks a stable image per article and spreads articles over the gallery", () => {
    expect(pickIndex("ea-conclui-venda", 10)).toBe(pickIndex("ea-conclui-venda", 10));
    const picks = new Set(["ea-a", "ea-b", "ea-c", "ea-d", "ea-e", "ea-f"].map((slug) => pickIndex(slug, 10)));
    expect(picks.size).toBeGreaterThan(2);
  });

  it("prefers the company games the article mentions", () => {
    expect(franchiseOf("STAR WARS™ Battlefront™ II")).toBe("star wars battlefront");
    expect(franchiseOf("Mass Effect™ Legendary Edition")).toBe("mass effect");
    const ea = [
      { name: "EA SPORTS FC™ 25", url: "https://cdn/fc.jpg" },
      { name: "Apex Legends™", url: "https://cdn/apex.jpg" },
      { name: "Mass Effect™ Legendary Edition", url: "https://cdn/me.jpg" },
      { name: "STAR WARS™ Battlefront™ II", url: "https://cdn/bf.jpg" },
    ];
    expect(galleryFor(ea, "Relatório: EA trocou Mass Effect por Star Wars Battlefront 3")).toEqual([
      "https://cdn/me.jpg",
      "https://cdn/bf.jpg",
    ]);
    expect(galleryFor(ea, "EA conclui venda para PIF")).toHaveLength(4);
  });
});
