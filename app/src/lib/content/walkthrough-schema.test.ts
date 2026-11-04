import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_GUIDE } from "@/lib/api/examples";
import { toPointer } from "@/lib/api/errors";
import { guidePayloadSchema } from "./guide-schema";
import { walkAchievementRefs, walkItemKeys, walkthroughSchema, type WalkthroughInput } from "./walkthrough-schema";

/** The robot's Phantom Blade Zero walkthrough (its contract fixture), fresh for each mutation. */
const fixture = (): WalkthroughInput =>
  JSON.parse(readFileSync(resolve(process.cwd(), "../ROBO NOTICIAS/test/guias/fixtures/walkthrough-pbz.json"), "utf8")) as WalkthroughInput;

/** A step body block with text (paragraph, callout...) or items (list), to mutate it in a test. */
const textBlock = (w: WalkthroughInput, step: number, block: number) => w.chapters[0].steps[step].body[block] as { text: string };
const listBlock = (w: WalkthroughInput, step: number, block: number) => w.chapters[0].steps[step].body[block] as { items: string[] };

const pointers = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => toPointer(i.path)) ?? [];

describe("walkthroughSchema", () => {
  it("aceita o fixture do Phantom Blade Zero", () => {
    const result = walkthroughSchema.safeParse(fixture());
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
    expect(fixture().chapters[0].steps).toHaveLength(9);
  });

  it("o local de um item vai até 800 caracteres (voz v2: caminho, para que serve e o risco)", () => {
    const w = fixture();
    w.chapters[0].steps[0].items[0].location = "a".repeat(800);
    expect(walkthroughSchema.safeParse(w).error?.issues).toBeUndefined();
    w.chapters[0].steps[0].items[0].location = "a".repeat(801);
    expect(pointers(walkthroughSchema.safeParse(w))).toEqual(["/chapters/0/steps/0/items/0/location"]);
  });

  it("recusa chave repetida entre item e capítulo", () => {
    const w = fixture();
    w.chapters[0].steps[0].items[0].key = w.chapters[0].key;
    const result = walkthroughSchema.safeParse(w);
    expect(result.success).toBe(false);
    expect(pointers(result)).toContain("/chapters/0/steps/0/items/0/key");
  });

  it("aceita ||spoiler|| fechado e recusa || sem par no texto, no leia antes e no local", () => {
    const w = fixture();
    expect(textBlock(w, 8, 0).text).toContain("||**Hua, a Noiva Mortal**||");
    w.readFirst[0].text = "Salve antes de ||o chefe final||.";
    w.chapters[0].steps[0].items[0].location = "Atrás de ||Hua||.";
    expect(walkthroughSchema.safeParse(w).error?.issues).toBeUndefined();

    w.readFirst[0].text = "Salve antes de ||o chefe final.";
    w.chapters[0].steps[0].items[0].location = "Atrás de Hua||.";
    listBlock(w, 6, 2).items[1] = "Fale com || o ferreiro||";
    const result = walkthroughSchema.safeParse(w);
    expect(pointers(result)).toEqual(
      expect.arrayContaining([
        "/readFirst/0/text",
        "/chapters/0/steps/0/items/0/location",
        "/chapters/0/steps/6/body/2/items/1",
      ]),
    );
    expect(result.error?.issues[0].message).toBe("Spoiler sem fechamento: use ||texto||");
  });

  it("recusa || no título de bloco e no cabeçalho de tabela (texto puro, a página mostraria as barras)", () => {
    const w = fixture();
    w.chapters[0].steps[0].body.push(
      { type: "heading", level: 3, text: "Antes de ||Hua||" },
      { type: "table", header: ["Chefe", "||Hua||"], rows: [["Ponto", "||Fraca a fogo||"]] },
    );
    const n = w.chapters[0].steps[0].body.length;
    const result = walkthroughSchema.safeParse(w);
    expect(pointers(result)).toEqual([`/chapters/0/steps/0/body/${n - 2}/text`, `/chapters/0/steps/0/body/${n - 1}/header/1`]);
    expect(result.error?.issues[0].message).toMatch(/não aceita \|\|/);
  });

  it("recusa cover.calls com 2 itens", () => {
    const w = fixture();
    w.cover.calls = w.cover.calls.slice(0, 2);
    expect(walkthroughSchema.safeParse(w).success).toBe(false);
  });

  it("item com index sem total é recusado", () => {
    const w = fixture();
    delete w.chapters[0].steps[0].items[0].total;
    const result = walkthroughSchema.safeParse(w);
    expect(result.success).toBe(false);
    expect(pointers(result)).toContain("/chapters/0/steps/0/items/0/total");
  });

  it("walkItemKeys lista as chaves dos itens", () => {
    const keys = walkItemKeys(walkthroughSchema.parse(fixture()));
    expect(keys).toHaveLength(10);
    expect(keys[0]).toBe("sino-lady-rift");
  });

  it("walkAchievementRefs lista item.achievement e countsFor com caminho", () => {
    const refs = walkAchievementRefs(walkthroughSchema.parse(fixture()));
    expect(refs).toContainEqual({
      apiName: "ACH_HEALER_LEGACY",
      path: "/chapters/0/steps/3/items/0/achievement",
    });
    expect(refs).toContainEqual({
      apiName: "ACH_ACCESSORY_COLLECTOR",
      path: "/chapters/0/steps/2/items/0/countsFor/0",
    });
  });
});

describe("walkthroughSchema: escopo do guia (R22)", () => {
  const psn = (over: Record<string, unknown> = {}) => ({
    ...fixture(),
    scope: "psn",
    psnList: { total: 3, names: ["With Heart and Blood", "Shadow Blade", "Phantom Blade Zero Platinum"] },
    steamOnly: ["ACH_STEAM_1", "ACH_STEAM_2"],
    ...over,
  });

  it("sem scope o guia é pela lista da Steam", () => {
    const w = walkthroughSchema.parse(fixture());
    expect(w.scope).toBe("steam");
    expect(w.psnList).toBeUndefined();
    expect(w.steamOnly).toBeUndefined();
  });

  it("scope psn com psnList e steamOnly é aceito", () => {
    const result = walkthroughSchema.safeParse(psn());
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toMatchObject({ scope: "psn", psnList: { total: 3 }, steamOnly: ["ACH_STEAM_1", "ACH_STEAM_2"] });
  });

  it("scope psn sem psnList ou sem steamOnly é recusado", () => {
    expect(pointers(walkthroughSchema.safeParse(psn({ psnList: undefined })))).toContain("/psnList");
    expect(pointers(walkthroughSchema.safeParse(psn({ steamOnly: undefined })))).toContain("/steamOnly");
  });

  it("psnList.names precisa ter os total troféus", () => {
    const result = walkthroughSchema.safeParse(psn({ psnList: { total: 36, names: ["Shadow Blade"] } }));
    expect(pointers(result)).toContain("/psnList/names");
  });

  it("steamOnly repetido é recusado", () => {
    expect(pointers(walkthroughSchema.safeParse(psn({ steamOnly: ["ACH_X", "ACH_X"] })))).toContain("/steamOnly/1");
  });

  it("scope steam não leva psnList nem steamOnly", () => {
    const result = walkthroughSchema.safeParse(psn({ scope: "steam" }));
    expect(pointers(result)).toEqual(expect.arrayContaining(["/psnList", "/steamOnly"]));
  });
});

describe("guidePayloadSchema com format", () => {
  it("payload com format 2 sem walkthrough é recusado", () => {
    const result = guidePayloadSchema.safeParse({ ...EXAMPLE_GUIDE, format: 2 });
    expect(result.success).toBe(false);
    expect(pointers(result)).toContain("/walkthrough");
  });

  it("format 1 continua aceito sem walkthrough", () => {
    const result = guidePayloadSchema.safeParse(EXAMPLE_GUIDE);
    expect(result.success).toBe(true);
    expect(result.data?.format).toBe(1);
  });

  it("format 2 com walkthrough é aceito quando phaseKey existe nas etapas", () => {
    const base = { ...EXAMPLE_GUIDE, format: 2, walkthrough: fixture() };
    expect(guidePayloadSchema.safeParse(base).success).toBe(false); // phaseKey does not match EXAMPLE_GUIDE steps
    const steps = EXAMPLE_GUIDE.steps.map((s, i) => ({ ...s, key: i === 0 ? "ate-mirage-estate" : `etapa-${i}` }));
    expect(guidePayloadSchema.safeParse({ ...base, steps }).success).toBe(true);
  });
});
