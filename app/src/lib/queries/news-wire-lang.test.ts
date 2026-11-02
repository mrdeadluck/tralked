import { describe, expect, it } from "vitest";
import { isEnglishHeadline, pickWireHeadlines, type ExternalHeadline } from "./news";

const at = (hours: number) => new Date(Date.UTC(2026, 10, 2, 12) - hours * 3_600_000);
const h = (id: string, title: string, hoursAgo: number, game: string | null = null): ExternalHeadline => ({
  id,
  title,
  url: `https://example.com/${id}`,
  source: "Fonte",
  publishedAt: at(hoursAgo),
  game: game ? { slug: game, name: game } : null,
});

describe("wire headlines language", () => {
  it("tells English from Portuguese headlines", () => {
    expect(isEnglishHeadline("GOG explores reviving physical PC game releases")).toBe(true);
    expect(isEnglishHeadline("Attack on Titan 3 game's new trailer introduces gameplay")).toBe(true);
    expect(isEnglishHeadline("Qual o melhor console para jogar GTA 6? Confira as opções")).toBe(false);
    expect(isEnglishHeadline("Filme de Elden Ring define elenco principal")).toBe(false);
  });

  it("prefers Portuguese, drops English stories a Portuguese headline already told, fills with English", () => {
    const rows = [
      h("en-told", "Elden Ring movie reveals its cast", 1, "elden-ring"),
      h("pt-1", "Filme de Elden Ring define elenco", 3, "elden-ring"),
      h("en-other", "GOG explores reviving physical releases", 2),
      h("pt-2", "Hollow Knight ganha atualização", 5, "hollow-knight"),
    ];
    expect(pickWireHeadlines(rows, 3).map((r) => r.id)).toEqual(["en-other", "pt-1", "pt-2"]);
    expect(pickWireHeadlines(rows, 2).map((r) => r.id)).toEqual(["pt-1", "pt-2"]);
  });
});
