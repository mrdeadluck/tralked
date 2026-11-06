import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACERVO, acervoFor } from "./acervo";

const PUBLIC_ACERVO = fileURLToPath(new URL("../../../public/acervo/", import.meta.url));

describe("acervoFor", () => {
  it("consoles win over their company", () => {
    expect(acervoFor("PS5 chega a 97,9 milhões")?.url).toBe("/acervo/ps5.webp");
    expect(acervoFor("PS5 Pro fica mais caro no Brasil")?.url).toBe("/acervo/ps5-pro.webp");
    expect(acervoFor("Nintendo comemora as vendas do Switch 2")?.url).toBe("/acervo/switch-2.webp");
    expect(acervoFor("Microsoft corta o preço do Xbox Series S")?.url).toBe("/acervo/xbox-series.webp");
    expect(acervoFor("Valve atualiza o Steam Deck")?.url).toBe("/acervo/steam-deck.webp");
  });

  it("companies by the first one the text names", () => {
    expect(acervoFor("Sony fala do PS6")?.url).toBe("/acervo/playstation.webp");
    expect(acervoFor("EA fecha a BioWare")?.url).toBe("/acervo/ea.webp");
    expect(acervoFor("itch.io terá filtro sem IA")?.url).toBe("/acervo/itch-io.webp");
    expect(acervoFor("Xbox Wire publica post sobre a Bethesda")?.url).toBe("/acervo/xbox.webp");
    expect(acervoFor("Bethesda confirma novo jogo; Xbox comemora")?.url).toBe("/acervo/bethesda.webp");
  });

  it("nothing for a text that names no console or company", () => {
    expect(acervoFor("Hollow Knight ganha DLC")).toBeNull();
    expect(acervoFor("Ideias para o fim de semana")).toBeNull();
    expect(acervoFor("Steamworks muda regras")).toBeNull();
  });

  it("every entry has its picture, alt and an official credit", () => {
    const files = new Set(readdirSync(PUBLIC_ACERVO));
    for (const entry of ACERVO) {
      expect(files.has(entry.file), entry.file).toBe(true);
      expect(entry.alt.length).toBeGreaterThan(5);
      expect(entry.credit).toMatch(/^Divulgação\/.+/);
    }
    expect(new Set(ACERVO.map((e) => e.key)).size).toBe(ACERVO.length);
  });
});
