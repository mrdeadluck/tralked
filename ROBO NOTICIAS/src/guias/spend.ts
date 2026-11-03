import type { SpendLedger } from "../ai/client.js";
import type { GuideDb } from "./db.js";

/**
 * Spend adapter for `createAi`: the cap is per guide request, not per day. Every call from the guide
 * robot uses the "backfill" bucket, whose check is `spentTotal`; `spentToday` answers the same number.
 */
export function guideSpend(db: GuideDb, requestId: string, _capUsd: number): SpendLedger {
  const spent = () => db.spentForRequest(requestId);
  return {
    spentToday: spent,
    spentTotal: spent,
    recordSpend: (_bucket, purpose, model, usd, at) => db.recordSpend(requestId, purpose, model, usd, at),
  };
}

/** The `config` to give `createAi` next to `guideSpend`: both budgets are the request cap. */
export function guideAiConfig(capUsd: number): { DAILY_BUDGET_USD: number; BACKFILL_BUDGET_USD: number } {
  return { DAILY_BUDGET_USD: capUsd, BACKFILL_BUDGET_USD: capUsd };
}
