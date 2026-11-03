import { describe, expect, it } from "vitest";
import { buildDossier, type GuideDossierSource } from "../../src/guias/dossier.js";
import { WRITER_CACHE_VERSION, earlierBaseKeys, earlierDraftKeys, writingBaseKey, writingKey } from "../../src/guias/writing-cache.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const MODELS = { MODEL_WRITER: "claude-opus-5-5", MODEL_CHECK: "claude-sonnet-5-5", CHECK_EFFORT: "high" as const };
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
    // Task 22: the checker's model and effort decide what was approved.
    expect(key({ models: { ...MODELS, MODEL_CHECK: "claude-haiku-5-5" } })).not.toBe(base);
    expect(key({ models: { ...MODELS, CHECK_EFFORT: "xhigh" } })).not.toBe(base);
    expect(key({ version: WRITER_CACHE_VERSION + 1 })).not.toBe(base);
    // Task 25 review: v6 (R39 count notes in assemble, code callouts of any tone out of the checked text). Voice v2: v7.
    expect(WRITER_CACHE_VERSION).toBe(7);
    // A rarity that crosses a band (1% → 30%) is a different "rarest" list: it changes.
    expect(key({ dossier: dossier(0.5) })).not.toBe(key({ dossier: dossier(30) }));
  });

  it("Task 21: a chave de base dos rascunhos ignora a versão do escritor e o manual, e muda com o resto", () => {
    const base = (over: Partial<Parameters<typeof writingBaseKey>[0]> = {}) =>
      writingBaseKey({ dossier: dossier(), game: GAME, models: MODELS, ...over });
    expect(base()).toMatch(/^base:[0-9a-f]{64}$/);
    expect(base()).toBe(base());
    expect(base({ dossier: dossier(10.7) })).toBe(base());
    expect(base({ dossier: dossier(10.2, "Sino Dourado") })).not.toBe(base());
    expect(base({ game: { ...GAME, name: "Outro Jogo" } })).not.toBe(base());
    expect(base({ scope: { psnList: { total: 1, names: ["The End"] }, steamOnly: [], steamTotal: 1 } })).not.toBe(base());
    expect(base({ models: { ...MODELS, MODEL_WRITER: "claude-sonnet-5-5" } })).not.toBe(base());
    // Task 22: only the writer's model: a new checker (model or effort) still carries the accepted texts, checked again.
    expect(base({ models: { ...MODELS, MODEL_CHECK: "claude-haiku-5-5", CHECK_EFFORT: "low" } })).toBe(base());
    // The v5 drafts (before Task 22) hashed the checker's model then (Haiku) into the base key: still found.
    const input = { dossier: dossier(), game: GAME, models: MODELS };
    // The exact base key d2f7bc2 gave these inputs (pinned).
    expect(earlierBaseKeys(input)).toEqual(["base:d66ee92ec833ff50d818c8f32c8f9c1308e953c47dce093decdf62a8b9c9faeb"]);
    expect(earlierBaseKeys(input)).not.toContain(base());
    // The writing key of the same inputs is a different thing (version and manual included).
    expect(key()).not.toBe(base());
  });

  it("Task 21: os rascunhos salvos antes da chave de base (v4) são achados pela chave da v4, com o manual de então", () => {
    const input = { dossier: dossier(), game: GAME, models: MODELS };
    const earlier = earlierDraftKeys(input);
    expect(earlier).toHaveLength(2);
    expect(earlier[0]).toMatch(/^escrita:[0-9a-f]{64}$/);
    // Not the current key (another version and manual), and only for the same inputs.
    expect(earlier).not.toContain(key());
    expect(earlierDraftKeys({ ...input, dossier: dossier(10.2, "Sino Dourado") })[0]).not.toBe(earlier[0]);
    // Task 22: still the exact v4 keys (v4 hashed MODEL_FAST, the checker's model then: Haiku), whatever checker now.
    const v4 = [
      "escrita:641abcb7d7950863a3ec5657a375ab646e159dd6fb345b1276342b001384af7e",
      "escrita:8668192dbd950387b454ec0fc1db1ecac41c77ca4d1ae245ffca19b00ce9ba5c",
    ];
    expect(earlier).toEqual(v4);
    expect(earlierDraftKeys({ ...input, models: { ...MODELS, MODEL_CHECK: "outro", CHECK_EFFORT: "max" } })).toEqual(v4);
  });
});
