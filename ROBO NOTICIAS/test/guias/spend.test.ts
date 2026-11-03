import { describe, expect, it } from "vitest";
import { openGuideDb } from "../../src/guias/db.js";
import { guideAiConfig, guideSpend } from "../../src/guias/spend.js";

describe("guideSpend", () => {
  it("guideSpend estoura no teto do pedido e não conta outro pedido", () => {
    const db = openGuideDb(":memory:");
    const mine = guideSpend(db, "req-1", 25);
    const other = guideSpend(db, "req-2", 25);
    other.recordSpend("backfill", "writer", "claude-opus-5-5", 30);
    expect(mine.spentTotal("backfill")).toBe(0);

    mine.recordSpend("backfill", "extract", "claude-sonnet-5-5", 10);
    mine.recordSpend("backfill", "writer", "claude-opus-5-5", 15.5);
    expect(mine.spentTotal("backfill")).toBeCloseTo(25.5);
    expect(mine.spentToday("backfill")).toBeCloseTo(25.5);
    expect(mine.spentTotal("backfill")).toBeGreaterThanOrEqual(guideAiConfig(25).BACKFILL_BUDGET_USD);
    expect(other.spentTotal("backfill")).toBe(30);
  });

  it("caps both budgets at the request cap", () => {
    expect(guideAiConfig(12)).toEqual({ DAILY_BUDGET_USD: 12, BACKFILL_BUDGET_USD: 12 });
  });
});
