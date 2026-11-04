import { describe, expect, it } from "vitest";
import {
  excerptSection,
  excerptsFor,
  FRAME_EXCERPT_CAP,
  foldPages,
  frameExcerpts,
  itemNames,
  JOB_EXCERPT_CAP,
  rankOf,
  withoutExcerpt,
  type SourcePage,
} from "../../src/guias/excerpts.js";
import type { SkelItem } from "../../src/guias/skeleton.js";
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

  it("a página do roteiro principal vem primeiro, as do mesmo site depois, as outras por último; a saída segue página e posição", () => {
    const one = (text: string, url: string, name: string): SourcePage => ({ url, name, text: `${filler(600)} ${text} ${filler(600)}` });
    const other = one("Congealeaf grows here.", "https://example.com/other", "Other");
    const region = one("Congealeaf #2 is behind the hut.", "https://www.powerpyx.com/region", "PowerPyx – Crimson Forest");
    const main = one("Congealeaf is for the tale.", "https://www.powerpyx.com/x", "PowerPyx");
    const pages = [other, region, main];
    const rank = rankOf(pages, { primaryScript: { name: "PowerPyx", chapters: [] } });
    expect(pages.map(rank)).toEqual([2, 1, 0]);
    const out = excerptsFor(pages, [{ key: "c", names: ["Congealeaf"] }], { cap: 1_200, rank });
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe(3);
    // With room for two windows: the named page, then its host-mate; never the other site first.
    expect(excerptsFor(pages, [{ key: "c", names: ["Congealeaf"] }], { cap: 2_400, rank }).map((e) => e.source)).toEqual([2, 3]);
  });

  it("revisão: os itens que precisam (perdível, missão, conta para conquista) passam primeiro; um perdível tardio ganha sua janela", () => {
    // 40 plain items fill the cap before the missable, which the page names last.
    const plain = Array.from({ length: 40 }, (_, n) => `Plain Thing ${n + 1}`);
    const text = plain.map((n) => `${filler(1100)} ${n}.`).join("") + `${filler(1100)} Old Lantern: lost after the boss. ${filler(1100)}`;
    const page: SourcePage = { url: "https://example.com/a", name: "A", text };
    const items = [...plain.map((n) => ({ key: n, names: [n] })), { key: "lantern", names: ["Old Lantern"], need: true }];
    const out = excerptsFor([page], items, { cap: 6_000 });
    expect(out.some((e) => e.keys.includes("lantern"))).toBe(true);
    expect(out.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(6_000 + 2 * out.length);
    // Without the flag it would be crowded out.
    const flat = excerptsFor([page], items.map(({ key, names }) => ({ key, names })), { cap: 6_000 });
    expect(flat.some((e) => e.keys.includes("lantern"))).toBe(false);
    // The items left without a window are counted.
    expect(withoutExcerpt(items, out).length).toBeGreaterThan(0);
    expect(withoutExcerpt(items, out)).not.toContain("lantern");
  });

  it("revisão: o que um item precisa vem do esqueleto (perdível, missão/conto/história, conta para conquista, conquista)", () => {
    const sk = (item: Record<string, unknown> | null, ach: Record<string, unknown> | null = null) =>
      itemNames({ key: "k", item: item && { kind: "collectible", name: "N", countsFor: [], missable: false, ...item }, ach } as unknown as SkelItem);
    expect(sk({}).need).toBe(false);
    expect(sk({ missable: true }).need).toBe(true);
    for (const kind of ["quest", "tale", "mission", "conto", "história", "missão"]) expect(sk({ kind }).need).toBe(true);
    expect(sk({ countsFor: ["ACH_X"] }).need).toBe(true);
    expect(sk({ achievement: "ACH_X" }).need).toBe(true);
    expect(sk(null, { nameEn: "The End", namePt: null, missable: false }).need).toBe(true);
    // The caps of the review.
    expect(JOB_EXCERPT_CAP).toBe(24_000);
    expect(FRAME_EXCERPT_CAP).toBe(12_000);
  });

  it("revisão: uma palavra comum curta (até 3 letras) não é procurada quando o item tem outro nome", () => {
    const page: SourcePage = { url: "https://example.com/a", name: "A", text: `${filler(100)} Take the key and the orb from the shelf. ${filler(100)}` };
    expect(excerptsFor([page], [{ key: "k", names: ["Key", "Rusty Key"] }], { cap: 14_000 })).toEqual([]);
    expect(excerptsFor([page], [{ key: "o", names: ["Orb", "Ancient Orb"] }], { cap: 14_000 })).toEqual([]);
    // Its only name: still looked for.
    expect(excerptsFor([page], [{ key: "k", names: ["Key"] }], { cap: 14_000 })).toHaveLength(1);
    // A two-letter name never.
    expect(excerptsFor([page], [{ key: "x", names: ["Ta"] }], { cap: 14_000 })).toEqual([]);
  });

  it("revisão: as páginas dobradas uma vez por execução dão o mesmo resultado", () => {
    const pages = [ROADMAP, REGION, WIKI];
    const items = [{ key: "c", names: ["Congealeaf"] }];
    expect(excerptsFor(pages, items, { cap: 3_000, folded: foldPages(pages) })).toEqual(excerptsFor(pages, items, { cap: 3_000 }));
  });

  it("revisão: a moldura fica no teto de 12.000 caracteres", () => {
    const names = Array.from({ length: 40 }, (_, n) => `Lost Tale ${n + 1}`);
    const page: SourcePage = { url: "https://www.powerpyx.com/r", name: "PowerPyx", text: names.map((n) => `${filler(1200)} ${n} fails after the boss.`).join("") };
    const dossier = {
      primaryScript: { name: "PowerPyx", chapters: [] },
      achievements: [],
      chapters: [{ items: names.map((n, i) => ({ id: `t${i}`, kind: "quest", name: n, missable: true })) }],
    } as unknown as GuideDossier;
    const out = frameExcerpts([page], dossier);
    expect(out.length).toBeGreaterThan(5);
    expect(out.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(FRAME_EXCERPT_CAP + 2 * out.length);
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
