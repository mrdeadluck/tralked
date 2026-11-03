import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_GUIDE } from "@/lib/api/examples";
import { toPointer } from "@/lib/api/errors";
import { guidePayloadSchema } from "./guide-schema";
import { walkAchievementRefs, walkItemKeys, walkthroughSchema } from "./walkthrough-schema";

const fixture = (): any =>
  JSON.parse(readFileSync(resolve(process.cwd(), "../ROBO NOTICIAS/test/guias/fixtures/walkthrough-pbz.json"), "utf8"));

const pointers = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => toPointer(i.path)) ?? [];

describe("walkthroughSchema", () => {
  it("aceita o fixture do Phantom Blade Zero", () => {
    const result = walkthroughSchema.safeParse(fixture());
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
    expect(fixture().chapters[0].steps).toHaveLength(9);
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
    expect(w.chapters[0].steps[8].body[0].text).toContain("||**Hua, a Noiva Mortal**||");
    w.readFirst[0].text = "Salve antes de ||o chefe final||.";
    w.chapters[0].steps[0].items[0].location = "Atrás de ||Hua||.";
    expect(walkthroughSchema.safeParse(w).error?.issues).toBeUndefined();

    w.readFirst[0].text = "Salve antes de ||o chefe final.";
    w.chapters[0].steps[0].items[0].location = "Atrás de Hua||.";
    w.chapters[0].steps[6].body[2].items[1] = "Fale com || o ferreiro||";
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
