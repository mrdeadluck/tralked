"use server";

import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { confirmFraud, fraudCaseSchema, releaseFraud } from "@/lib/admin/fraud";

type Decision = AdminResult<{ entries: number; levelBefore: number | null; levelAfter: number | null }>;

/** "Confirmar fraude": voids the XP of the case and lowers the level (admin only). */
export async function confirmFraudAction(raw: unknown): Promise<Decision> {
  const ready = await authorizeAction("admin", fraudCaseSchema, raw);
  if (!ready.ok) return ready;
  const result = await confirmFraud(ready.data);
  if (!result.ok) return result;
  return { ok: true, entries: result.entries, levelBefore: result.levelBefore, levelAfter: result.levelAfter };
}

/** "Liberar": the unlocks count again and are paid (admin only). */
export async function releaseFraudAction(raw: unknown): Promise<Decision> {
  const ready = await authorizeAction("admin", fraudCaseSchema, raw);
  if (!ready.ok) return ready;
  const result = await releaseFraud(ready.data);
  if (!result.ok) return result;
  return { ok: true, entries: result.entries, levelBefore: result.levelBefore, levelAfter: result.levelAfter };
}
