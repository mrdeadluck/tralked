"use server";

import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { changeRole, roleChangeSchema } from "@/lib/admin/users";

/** Changes another user's role (admin only; never your own). */
export async function changeRoleAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", roleChangeSchema, raw);
  if (!ready.ok) return ready;
  return changeRole(ready.user.id, ready.data);
}
