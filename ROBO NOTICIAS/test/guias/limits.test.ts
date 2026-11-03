import { describe, expect, it } from "vitest";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { buildDossier } from "../../src/guias/dossier.js";
import { bodyBytes, estimatePayloadBytes, fitBody, imagesWorthTrying, SITE_LIMITS, skeletonLimitProblems } from "../../src/guias/limits.js";
import { buildReport } from "../../src/guias/report.js";
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

describe("imagens perto do limite", () => {
  it("a estimativa é grosseira: um pouco acima do limite as imagens ainda são tentadas; bem acima, não", () => {
    expect(imagesWorthTrying({ withImages: SITE_LIMITS.bodyBytes + 30_000 })).toBe(true);
    expect(imagesWorthTrying({ withImages: SITE_LIMITS.bodyBytes * 1.3 })).toBe(false);
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

  it("passando por causa das imagens, as imagens saem primeiro", () => {
    const body = withItems(2500, true);
    expect(bodyBytes(body)).toBeGreaterThan(SITE_LIMITS.bodyBytes);
    const fit = fitBody(body);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.bytes).toBeLessThanOrEqual(SITE_LIMITS.bodyBytes);
    expect(fit.body.walkthrough!.chapters[0]!.steps.every((s) => s.items.every((i) => i.image === undefined))).toBe(true);
    expect(fit.dropped).toEqual([expect.stringContaining("imagens dos itens ficaram de fora")]);
  });

  it("sem imagens ainda grande demais: não cabe", () => {
    const fit = fitBody(withItems(4000, false));
    expect(fit.ok).toBe(false);
    expect(fit.bytes).toBeGreaterThan(SITE_LIMITS.bodyBytes);
  });
});
