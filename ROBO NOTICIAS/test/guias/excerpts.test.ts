import { describe, expect, it } from "vitest";
import { excerptSection, excerptsFor, frameExcerpts, primaryOf, type SourcePage } from "../../src/guias/excerpts.js";
import type { GuideDossier } from "../../src/guias/dossier.js";

const filler = (n: number) => "Lorem ipsum dolor sit amet. ".repeat(Math.ceil(n / 28)).slice(0, n);

const ROADMAP: SourcePage = {
  url: "https://www.powerpyx.com/pbz-trophy-guide-roadmap/",
  name: "PowerPyx",
  role: "roteiro_psn",
  text:
    `${filler(2000)} Apprentice Healer: collect the 3 herbs: Blood-Stopper Vine, Congealeaf, Blemish Goldweed. ` +
    `Complete it before defeating Jing Ye or you'll fail the tale. ${filler(3000)}`,
};
const REGION: SourcePage = {
  url: "https://www.powerpyx.com/pbz-crimson-forest-collectibles/",
  name: "PowerPyx – Crimson Forest",
  role: "coletaveis",
  text: `${filler(1500)} Congealeaf #2: behind the hut, next to the chest. ${filler(1500)}`,
};
const WIKI: SourcePage = {
  url: "https://phantombladezero.wiki.fextralife.com/Congealeaf",
  name: "Fextralife",
  role: "confirmacao",
  text: `${filler(800)} CONGEALEAF is a herb used by Yu'er. ${filler(800)}`,
};

describe("trechos das fontes por item (Task 5)", () => {
  it("acha a menção em várias páginas, sem caixa nem acento, e devolve a janela de ±500 caracteres", () => {
    const out = excerptsFor([ROADMAP, REGION, WIKI], [{ key: "congealeaf", names: ["Congealeaf"] }], { cap: 14_000 });
    expect(out.map((e) => e.source)).toEqual([1, 2, 3]);
    expect(out[0]!.text).toContain("collect the 3 herbs: Blood-Stopper Vine, Congealeaf, Blemish Goldweed");
    expect(out[0]!.text).toContain("you'll fail the tale");
    expect(out[2]!.text).toContain("CONGEALEAF is a herb used by Yu'er.");
    for (const e of out) {
      expect(e.keys).toEqual(["congealeaf"]);
      expect(e.text.length).toBeLessThanOrEqual(1000 + "Congealeaf".length + 2);
    }
    // Accents and case on the name side too.
    const accented = excerptsFor([{ ...WIKI, text: `${filler(100)} a Erva Congélea fica no baú. ${filler(100)}` }], [{ key: "x", names: ["erva congelea"] }], {
      cap: 14_000,
    });
    expect(accented).toHaveLength(1);
  });

  it("nunca acha pedaço de palavra", () => {
    const page = { ...WIKI, text: `${filler(50)} Bellringer and Bells are not it. ${filler(50)}` };
    expect(excerptsFor([page], [{ key: "bell", names: ["Bell"] }], { cap: 14_000 })).toEqual([]);
    const whole = { ...WIKI, text: `${filler(50)} Ring the Bell, then go. ${filler(50)}` };
    expect(excerptsFor([whole], [{ key: "bell", names: ["Bell"] }], { cap: 14_000 })).toHaveLength(1);
  });

  it("janelas que se sobrepõem viram uma, com as keys dos itens que ela cobre", () => {
    const out = excerptsFor(
      [ROADMAP],
      [
        { key: "vine", names: ["Blood-Stopper Vine"] },
        { key: "goldweed", names: ["Blemish Goldweed"] },
      ],
      { cap: 14_000 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.keys).toEqual(["vine", "goldweed"]);
  });

  it("o teto é respeitado e cada item ganha ao menos uma janela antes de qualquer segunda", () => {
    // Every item is mentioned three times, far apart; the cap fits about one window per item.
    const names = ["Alpha Herb", "Beta Stone", "Gamma Key", "Delta Bell"];
    const text = [1, 2, 3].map(() => names.map((n) => `${filler(1500)} ${n} here.`).join("")).join("") + filler(1500);
    const page: SourcePage = { url: "https://example.com/a", name: "A", text };
    const items = names.map((n) => ({ key: n, names: [n] }));
    const out = excerptsFor([page], items, { cap: 4_400 });
    expect(out.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(4_400 + 2 * out.length);
    expect(new Set(out.flatMap((e) => e.keys))).toEqual(new Set(names));
    expect(out).toHaveLength(4);
  });

  it("as páginas do roteiro principal vêm primeiro na escolha; a saída segue página e posição", () => {
    const one = (text: string, url: string, name: string): SourcePage => ({ url, name, text: `${filler(600)} ${text} ${filler(600)}` });
    const other = one("Congealeaf grows here.", "https://example.com/other", "Other");
    const main = one("Congealeaf is for the tale.", "https://www.powerpyx.com/x", "PowerPyx");
    const primary = primaryOf([other, main], { primaryScript: { name: "PowerPyx", chapters: [] } });
    const out = excerptsFor([other, main], [{ key: "c", names: ["Congealeaf"] }], { cap: 1_200, primary });
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe(2);
    // Pages of the primary's host count as primary too (region pages).
    expect(primary(REGION)).toBe(true);
    expect(primary(WIKI)).toBe(false);
  });

  it("é determinístico", () => {
    const items = [{ key: "c", names: ["Congealeaf"] }, { key: "v", names: ["Blood-Stopper Vine"] }];
    expect(excerptsFor([ROADMAP, REGION, WIKI], items, { cap: 3_000 })).toEqual(excerptsFor([ROADMAP, REGION, WIKI], items, { cap: 3_000 }));
  });

  it("a moldura lê a página do roteiro em volta dos perdíveis e das missões, com o índice da página na lista inteira", () => {
    const dossier = {
      primaryScript: { name: "PowerPyx", chapters: [] },
      achievements: [{ apiName: "ACH_HEALER", nameEn: "The Healer's Legacy", namePt: null, missable: true }],
      chapters: [{ items: [{ id: "tale", kind: "quest", name: "Apprentice Healer", missable: false }] }],
    } as unknown as GuideDossier;
    const out = frameExcerpts([WIKI, ROADMAP], dossier);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 2, keys: ["tale"] });
    expect(out[0]!.text).toContain("you'll fail the tale");
  });

  it("a seção do escritor marca cada trecho pelo índice da fonte, nunca pelo nome do site, e escapa o texto", () => {
    const section = excerptSection([{ source: 3, text: "Use <b>this</b> herb.", keys: ["x"] }]);
    expect(section).toContain("## Trechos das fontes (material de apuração, em inglês ou outra língua; não copie)");
    expect(section).toContain('<trecho fonte="3">Use &lt;b&gt;this&lt;/b&gt; herb.</trecho>');
    expect(section).not.toContain("Fextralife");
    expect(excerptSection([])).toBe("");
  });
});
