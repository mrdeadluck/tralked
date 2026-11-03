import { describe, expect, it } from "vitest";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { buildDossier } from "../../src/guias/dossier.js";
import { bodyBytes, estimatePayloadBytes, fitBody, imageOrder, SITE_LIMITS, skeletonLimitProblems } from "../../src/guias/limits.js";
import { buildReport, type RobotReport } from "../../src/guias/report.js";
import { buildSkeleton } from "../../src/guias/skeleton.js";
import { chapter, fact, item, steamAch } from "./helpers-dossier.js";

const steam = [steamAch("ACH_END", "The End", "Finish the story.")];

function dossierWith(chapters: number, itemsPerChapter: number) {
  const f = fact("PowerPyx", "roteiro_psn", {
    chapters: Array.from({ length: chapters }, (_, c) =>
      chapter(`Região ${c + 1}`, Array.from({ length: itemsPerChapter }, (_, i) => item(`Sino ${c + 1}-${i + 1}`)), c + 1),
    ),
  });
  return buildDossier(steam, [f], [[f.source.url]]);
}

describe("limites do site antes de gastar (C2)", () => {
  it("61 capítulos: o guia não cabe; 60 cabem", () => {
    expect(skeletonLimitProblems(buildSkeleton(dossierWith(59, 1)))).toEqual([]);
    // 61 + the cleanup chapter of the loose achievement.
    expect(skeletonLimitProblems(buildSkeleton(dossierWith(61, 1)))).toEqual([`O guia teria 62 capítulos; o site aceita até ${SITE_LIMITS.chapters}.`]);
  });

  it("um capítulo enorme vira no máximo 80 passos; passos com mais de 40 itens são apontados", () => {
    const skel = buildSkeleton(dossierWith(1, 3300));
    expect(skel.chapters[0]!.steps.length).toBeLessThanOrEqual(80);
    const problems = skeletonLimitProblems(skel);
    expect(problems[0]).toMatch(/^O passo regiao-1-1 teria 42 itens; o site aceita até 40\.$/);
  });

  it("a estimativa de tamanho cresce com os itens e conta as imagens à parte", () => {
    const small = estimatePayloadBytes(buildSkeleton(dossierWith(2, 10)), dossierWith(2, 10));
    const big = estimatePayloadBytes(buildSkeleton(dossierWith(20, 60)), dossierWith(20, 60));
    expect(big.withoutImages).toBeGreaterThan(small.withoutImages * 10);
    expect(big.withImages - big.withoutImages).toBeGreaterThan(1200 * 300);
    expect(big.withImages).toBeGreaterThan(SITE_LIMITS.bodyBytes);
  });
});

describe("ordem das imagens depois da escrita (fix 4)", () => {
  it("perdíveis primeiro, depois coletáveis contados, depois o resto, cada grupo na ordem da rota", () => {
    const it = (key: string, extra: { missable?: boolean; countsFor?: string[] } = {}) => ({ key, missable: false, countsFor: [], ...extra });
    const chapters = [
      { steps: [{ items: [it("a"), it("b", { countsFor: ["ACH_X"] })] }] },
      { steps: [{ items: [it("c", { missable: true }), it("d")] }, { items: [it("e", { countsFor: ["ACH_X"] }), it("f", { missable: true })] }] },
    ];
    expect(imageOrder(chapters).map((i) => i.key)).toEqual(["c", "f", "b", "e", "a", "d"]);
  });
});

describe("fitBody: o corpo final cabe em 1 MiB", () => {
  const report = buildReport({ sourcesRead: [], spendUsd: 0 });
  const withItems = (n: number, image: boolean, location = "x".repeat(300)) =>
    ({
      walkthrough: {
        chapters: [
          {
            key: "c",
            steps: Array.from({ length: n }, (_, i) => ({
              key: `s${i}`,
              body: [],
              items: [{ key: `i${i}`, location, ...(image ? { image: { url: "https://cdn.tralked.com/x.webp", credit: "c".repeat(150), sourceName: "PowerPyx", sourceUrl: "https://www.powerpyx.com/x" } } : {}) }],
            })),
          },
        ],
      },
      report,
    }) as unknown as Partial<GuidePayloadV2> & { walkthrough: GuidePayloadV2["walkthrough"]; report: typeof report };

  it("cabendo, sai como está", () => {
    const body = withItems(10, true);
    expect(fitBody(body)).toEqual({ ok: true, body, bytes: bodyBytes(body), dropped: [] });
  });

  it("passando por causa das imagens, saem imagens aos poucos, do fim da rota para o começo, só as necessárias", () => {
    const body = withItems(2500, true);
    expect(bodyBytes(body)).toBeGreaterThan(SITE_LIMITS.bodyBytes);
    const fit = fitBody(body);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.bytes).toBeLessThanOrEqual(SITE_LIMITS.bodyBytes);
    const items = fit.body.walkthrough!.chapters[0]!.steps.flatMap((s) => s.items);
    const kept = items.filter((i) => i.image).length;
    expect(kept).toBeGreaterThan(0);
    // The ones kept are the first of the route, and one more would not fit.
    expect(items.slice(0, kept).every((i) => i.image)).toBe(true);
    expect(items.slice(kept).every((i) => !i.image)).toBe(true);
    expect(SITE_LIMITS.bodyBytes - fit.bytes).toBeLessThan(400);
    expect(fit.dropped).toEqual([`${2500 - kept} imagens de itens ficaram de fora, do fim da rota para o começo, para o guia caber em 1024 KiB`]);
    // The input is not changed.
    expect(body.walkthrough.chapters[0]!.steps.at(-1)!.items[0]!.image).toBeDefined();
  });

  it("no corte do relatório, os perdíveis não posicionados vêm primeiro e o aviso do R30 nunca sai", () => {
    const unplaced = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i} ${"n".repeat(200)}`, chapter: "c", source: "s", missable: i >= 25, returnLater: false, countsFor: [], countsForEn: [] }));
    const warning = "5 itens perdíveis aparecem só em fonte secundária e ficaram fora da rota (sem posição): x.";
    const fullReport = {
      ...report,
      divergences: [...Array.from({ length: 40 }, (_, i) => `divergência ${i} ${"d".repeat(500)}`), warning],
      unplaced: { title: "Itens só de fonte secundária, não posicionados" as const, items: unplaced },
    };
    // Just over the cap: the long lists of the report have to be cut.
    const small = { ...withItems(1, false, "x"), report: fullReport };
    const big = { ...withItems(1, false, "x".repeat(SITE_LIMITS.bodyBytes - bodyBytes(small) + 3000)), report: fullReport };
    const fit = fitBody(big);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.body.report.divergences).toContain(warning);
    const cut = (fit.body.report as RobotReport).unplaced!;
    expect(cut.items.slice(0, 5).every((i) => i.missable)).toBe(true);
    expect(cut.omitted).toBe(10);
  });

  it("sem imagens ainda grande demais: não cabe", () => {
    const fit = fitBody(withItems(4000, false));
    expect(fit.ok).toBe(false);
    expect(fit.bytes).toBeGreaterThan(SITE_LIMITS.bodyBytes);
  });
});
