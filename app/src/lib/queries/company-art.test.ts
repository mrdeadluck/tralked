import { describe, expect, it } from "vitest";
import { companiesIn } from "./company-art";

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
});
