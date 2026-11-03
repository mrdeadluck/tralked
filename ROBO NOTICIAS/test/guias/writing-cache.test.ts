import { describe, expect, it } from "vitest";
import { buildDossier, type GuideDossierSource } from "../../src/guias/dossier.js";
import { WRITER_CACHE_VERSION, writingKey } from "../../src/guias/writing-cache.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const MODELS = { MODEL_WRITER: "claude-opus-5-5", MODEL_FAST: "claude-haiku-5-5" };
const GAME: GuideDossierSource["game"] = {
  slug: "phantom-test",
  name: "Phantom Test",
  steamAppId: 4115450,
  summary: null,
  developer: "S-Game",
  publisher: "S-Game",
  releaseDate: null,
  platforms: ["PC"],
  criticScore: 81,
  timeToBeatCompleteMin: 2400,
  achievementCount: 1,
};

function dossier(pct = 10.2, bell = "Bell") {
  const steam = [{ ...steamAch("ACH_END", "The End", "Finish the story."), globalPct: pct }];
  const f = fact("PowerPyx", "roteiro_psn", { achievements: [ach("The End")], chapters: [chapter("Weeping Creek", [item(bell)])] });
  return buildDossier(steam, [f], [[f.source.url]]);
}

const key = (over: Partial<Parameters<typeof writingKey>[0]> = {}) => writingKey({ dossier: dossier(), game: GAME, models: MODELS, ...over });

describe("chave do cache da escrita", () => {
  it("o que o site atualiza todo dia (raridade, nota, tempo) não muda a chave", () => {
    expect(key({ dossier: dossier(10.7) })).toBe(key());
    expect(key({ game: { ...GAME, criticScore: 82, timeToBeatCompleteMin: 2410 } })).toBe(key());
  });

  it("muda com jogo, dossiê, escopo, modelos e versão do escritor", () => {
    const base = key();
    expect(key({ game: { ...GAME, name: "Outro Jogo" } })).not.toBe(base);
    expect(key({ dossier: dossier(10.2, "Sino Dourado") })).not.toBe(base);
    expect(key({ scope: { psnList: { total: 1, names: ["The End"] }, steamOnly: [], steamTotal: 1 } })).not.toBe(base);
    expect(key({ models: { ...MODELS, MODEL_WRITER: "claude-sonnet-5-5" } })).not.toBe(base);
    expect(key({ models: { ...MODELS, MODEL_FAST: "claude-sonnet-5-5" } })).not.toBe(base);
    expect(key({ version: WRITER_CACHE_VERSION + 1 })).not.toBe(base);
    // A rarity that crosses a band (1% → 30%) is a different "rarest" list: it changes.
    expect(key({ dossier: dossier(0.5) })).not.toBe(key({ dossier: dossier(30) }));
  });
});
