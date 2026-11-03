import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPendingAlerts } from "../../src/alerts.js";
import { parseGuiaArgs } from "../../src/commands/guia.js";
import { openGuideDb, type GuideDb } from "../../src/guias/db.js";
import type { SteamAchievement } from "../../src/guias/dossier.js";
import { dryRun } from "../../src/guias/dry-run.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { PAGE_TEXT_VERSION } from "../../src/guias/page-text.js";
import { extractionKey } from "../../src/guias/pipeline.js";
import { saveRunContext } from "../../src/guias/run-context.js";

type Fixture = { steam: SteamAchievement[]; facts: ExtractedFacts[]; intro: Record<string, string> };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pbz-trimmed-facts.json", import.meta.url), "utf8")) as Fixture;
const CONFIG = { MODEL_WRITER: "claude-opus-5-5", MODEL_EXTRACT: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-5-5", GUIDE_STEAM_REFERENCE_ID: "76561198012210783" };
const GAME = {
  slug: "phantom-blade-zero",
  name: "Phantom Blade Zero",
  steamAppId: 4115450,
  summary: null,
  developer: "S-GAME",
  publisher: "S-GAME",
  releaseDate: null,
  platforms: ["PC"],
  criticScore: null,
  timeToBeatCompleteMin: null,
  achievementCount: 3,
};

/** The PBZ fixture as a cache: every page stored; the allthings.how extraction from an older prompt; no zh extraction. */
function cache(): GuideDb {
  const db = openGuideDb(":memory:");
  for (const f of fixture.facts) {
    const text = `${fixture.intro[f.source.url] ?? ""}\n${f.source.name}`;
    db.savePage({ url: f.source.url, fetchedAt: new Date("2026-11-03T07:00:00Z"), status: "ok", finalUrl: f.source.url, text, html: "<html></html>", textVersion: PAGE_TEXT_VERSION });
    if (f.source.language === "zh") continue;
    const key = f.source.name === "allthings.how" ? "fatos:prompt-antigo" : extractionKey(CONFIG.MODEL_EXTRACT, f.source, text);
    db.setMeta(key, JSON.stringify(f));
  }
  saveRunContext(db, {
    requestId: "req-pbz",
    steamAppId: 4115450,
    gameSlug: GAME.slug,
    game: GAME,
    steamList: fixture.steam,
    sources: fixture.facts.map((f) => f.source),
    savedAt: "2026-11-03T07:00:00.000Z",
  });
  return db;
}

afterEach(() => vi.restoreAllMocks());

describe("ensaio grátis (pnpm guia -- --ensaio)", () => {
  it("só com o cache: escopo, capítulos em ordem, confirmados, lacunas, tamanho e custo; sem rede", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const lines: string[] = [];
    const db = cache();
    const result = await dryRun({ db, config: CONFIG, appId: 4115450, log: (l) => lines.push(l) });
    const out = lines.join("\n");
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(out).toContain("ensaio (sem IA, sem rede, só o cache): pedido req-pbz, appid 4115450, Phantom Blade Zero");
    // The Chinese guide has no cached extraction; allthings.how's comes from an older prompt.
    expect(out).toMatch(/Steam: 影之刃零全成就指南 \(Lankec\): sem extração no cache/);
    expect(out).toMatch(/allthings\.how \[coletaveis\]: .* extração ANTIGA/);
    expect(out).toMatch(/extração a refazer na execução real: 2 página\(s\)/);
    expect(out).toContain("roteiro principal: PowerPyx");
    expect(out).toContain("etapas do roadmap (4): Step 1: Complete the Game up to the Mirage Estate | Step 2");
    const chapters = lines.filter((l) => /^ +\d+\. /.test(l)).map((l) => l.trim());
    expect(chapters).toEqual([
      "1. First Visit — Weeping Creek Valley — 8 itens (1 confirmados)",
      "2. First Visit — Crimson Forest — 4 itens (0 confirmados)",
      "3. Mirage Estate — 3 itens (0 confirmados)",
      "4. Crimson Forest Cleanup #3 — 2 itens (0 confirmados) [revisita]",
      "5. Clean Up Visits — Weeping Creek Valley — 4 itens (0 confirmados) [revisita, posição assumida, revisão]",
      "6. Clean Up Visits — Crimson Forest — 2 itens (0 confirmados) [revisita, posição assumida, revisão]",
    ]);
    expect(out).toMatch(/itens: 23; confirmados por 2\+ fontes: 1; de uma fonte só: 22; itens de fontes secundárias sem par \(só corroboram\): 1/);
    expect(out).toMatch(/gate steam: \d+ lacuna\(s\); gate psn: \d+ lacuna\(s\)/);
    expect(out).toContain("escopo escolhido: nenhum (o pedido ficaria em waiting_sources)");
    expect(out).toMatch(/falta \(steam\): /);
    expect(out).toMatch(/limites do site: 7\/60 capítulos \(com a limpeza\), .* → cabe/);
    expect(out).toMatch(/tamanho estimado do guia: ~\d+ KiB sem imagens, ~\d+ KiB com imagens \(limite 1024 KiB\)/);
    expect(out).toMatch(/custo estimado da escrita: \d+ chamadas de claude-opus-5-5 .* ~US\$ \d+\.\d\d numa passada, até ~US\$ \d+\.\d\d com a reescrita/);
    expect(result.ok).toBe(false);
  });

  it("pedido sem nada salvo: diz o que existe, sem inventar", async () => {
    const lines: string[] = [];
    const db = cache();
    db.saveDossier("req-velho", { chapters: [], achievements: [], unreadSources: [] });
    expect(await dryRun({ db, config: CONFIG, appId: 999, log: (l) => lines.push(l) })).toEqual({ ok: false });
    expect(lines).toEqual(["ensaio: nada salvo para o appid 999. Pedidos com dossiê salvo: req-velho (use --pedido <id>)."]);
  });

  it("argumentos do comando", () => {
    expect(parseGuiaArgs([])).toEqual({ dryRun: false });
    expect(parseGuiaArgs(["--", "--ensaio", "--appid", "4115450"])).toEqual({ dryRun: true, appId: 4115450 });
    expect(parseGuiaArgs(["--ensaio", "--pedido", "abc", "--dados", "/tmp/copia"])).toEqual({ dryRun: true, requestId: "abc", dataDir: "/tmp/copia" });
    expect(() => parseGuiaArgs(["--ensaio"])).toThrow("--appid");
    expect(() => parseGuiaArgs(["--ensaio", "--appid", "x"])).toThrow("appid inválido");
  });
});

describe("alerta guia-falha-robo por e-mail", () => {
  it("vai pelo mesmo caminho dos alertas do robô de notícias, quando RESEND_API_KEY e ALERT_EMAIL existem", async () => {
    const db = openGuideDb(":memory:");
    db.addAlert("guia-falha-robo", "pedido req-1: falha do robô: Streaming is required", new Date("2026-11-03T12:00:00Z"));
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"id":"x"}', { status: 200 }));
    expect(await sendPendingAlerts(db, {}, fetchFn, new Date(), "de guias")).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();

    expect(await sendPendingAlerts(db, { RESEND_API_KEY: "re_x", ALERT_EMAIL: "dono@example.com" }, fetchFn, new Date(), "de guias")).toBe(1);
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string) as { to: string[]; text: string };
    expect(body.to).toEqual(["dono@example.com"]);
    expect(body.text).toContain("O robô de guias registrou 1 alerta");
    expect(body.text).toContain("guia-falha-robo: pedido req-1: falha do robô: Streaming is required");
    expect(db.alerts()[0]!.emailed).toBe(1);
  });
});
