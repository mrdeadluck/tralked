import { beforeEach, describe, expect, it } from "vitest";
import { buildGasto, formatGasto } from "../src/commands/gasto.js";
import { openDb, type Db } from "../src/db.js";

const NOW = new Date("2026-11-05T18:00:00Z");
const use = (tokens: number, usd: number, week: number | null = null) => ({
  model: "claude-opus-5-5",
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usdEquivalent: usd,
  weeklyUtilization: week,
});

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});

function publishedStory(headline: string, title: string, at: Date): number {
  const id = db.upsertStory(
    { key: headline, headline, category: "GAMES", score: 80, bomb: false, rumor: false, gamesJson: "[]", mode: "live", status: "published", lastItemAt: at.toISOString() },
    at,
  );
  db.saveArticle({ storyId: id, payloadJson: JSON.stringify({ title }), status: "published", siteId: `s${id}`, slug: `s${id}`, publishedAt: at.toISOString() }, at);
  return id;
}

describe("pnpm gasto", () => {
  it("adds up the Claude Code usage per published article, apart from the collection, with the weekly window", () => {
    const a = publishedStory("A", "Matéria A", new Date("2026-11-05T15:00:00Z"));
    const b = publishedStory("B", "Matéria B", new Date("2026-11-05T16:00:00Z"));
    db.recordClaudeUsage(use(30_000, 0.3), { purpose: "write", storyId: a });
    db.recordClaudeUsage(use(10_000, 0.1), { purpose: "check", storyId: a });
    db.recordClaudeUsage(use(20_000, 0.2), { purpose: "write", storyId: b });
    db.recordClaudeUsage(use(5_000, 0.01, 0.47), { purpose: "triage" });

    const report = buildGasto(db, 1, NOW);
    expect(report.articles.map((x) => [x.title, x.tokens, x.runs])).toEqual([
      ["Matéria B", 20_000, 1],
      ["Matéria A", 40_000, 2],
    ]);
    expect(report.collection).toMatchObject({ runs: 1, tokens: 5_000 });
    expect(report.weeklyUtilization).toBe(0.47);

    const text = formatGasto(report);
    expect(text).toMatch(/Matérias: 2 · 60\.000 tokens/);
    expect(text).toMatch(/média por matéria 30\.000 tokens/);
    expect(text).toMatch(/47% usado/);
  });

  it("a pauta's runs, tagged while it is written, count for it once it is saved", () => {
    db.recordClaudeUsage(use(8_000, 0.08), { purpose: "pauta", tag: "pauta-1" });
    const at = new Date("2026-11-05T17:00:00Z");
    const id = db.raw
      .prepare(
        "INSERT INTO pautas (game_name, status, mode, story_date, published_at, created_at, payload_json) VALUES ('Hades', 'published', 'live', '2026-11-05', ?, ?, ?)",
      )
      .run(at.toISOString(), at.toISOString(), JSON.stringify({ title: "Hades tem 49 conquistas" })).lastInsertRowid as number;
    db.linkUsageTag("pauta-1", { pautaId: id });

    const report = buildGasto(db, 1, NOW);
    expect(report.articles).toEqual([expect.objectContaining({ kind: "pauta", title: "Hades tem 49 conquistas", tokens: 8_000 })]);
    expect(report.collection.runs).toBe(0);
  });
});
