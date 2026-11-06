import { describe, expect, it } from "vitest";
import { companyArt, pickIndex, withCompanyArt } from "./company-art";

const card = (title: string, imageUrl: string | null = null) => ({ slug: title.toLowerCase().replace(/\W+/g, "-"), title, excerpt: null, imageUrl });

describe("company art (official acervo, never a company game)", () => {
  it("a card without a game or an image gets the company's official picture", async () => {
    const [out] = await withCompanyArt([card("Bethesda anuncia evento para dezembro")]);
    expect(out).toMatchObject({ imageUrl: "/acervo/bethesda.webp", wideImageUrl: "/acervo/bethesda.webp", art: null });
  });

  it("a card with its own image keeps it; a text naming no company stays as it is", async () => {
    const [own, none] = await withCompanyArt([card("Bethesda mostra arte", "https://blob.test/a.webp"), card("Ideias para o fim de semana")]);
    expect(own!.imageUrl).toBe("https://blob.test/a.webp");
    expect(none!.imageUrl).toBeNull();
    expect(none).not.toHaveProperty("art");
  });

  it("M5: a card with its game's art keeps it (the console or company picture is only for cards without a game)", async () => {
    const withGame = { ...card("Ghost of Yōtei vende 3 milhões no PS5"), art: [{ url: "https://cdn.test/ghost.jpg" }] };
    const [out] = await withCompanyArt([withGame]);
    expect(out!.imageUrl).toBeNull();
    expect(out!.art).toEqual([{ url: "https://cdn.test/ghost.jpg" }]);
  });

  it("the article page's hero uses the same picture", async () => {
    expect(await companyArt("EA fecha a BioWare")).toBe("/acervo/ea.webp");
    expect(await companyArt("Hollow Knight ganha DLC")).toBeNull();
  });

  it("pickIndex is stable per seed and spreads seeds", () => {
    expect(pickIndex("ea-conclui-venda", 10)).toBe(pickIndex("ea-conclui-venda", 10));
    const picks = new Set(["ea-a", "ea-b", "ea-c", "ea-d", "ea-e", "ea-f"].map((slug) => pickIndex(slug, 10)));
    expect(picks.size).toBeGreaterThan(2);
  });
});
