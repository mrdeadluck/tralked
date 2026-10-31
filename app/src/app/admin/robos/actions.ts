"use server";

import { z } from "zod";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { API_SCOPES, createApiKey, revokeApiKey } from "@/lib/api/keys";
import { prisma } from "@/lib/db";

const newKeySchema = z.strictObject({
  name: z.string().trim().min(1, "Dê um nome à chave").max(60, "No máximo 60 caracteres"),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Escolha ao menos um escopo"),
});

/**
 * Creates a bot key (admin only). The secret is returned once, for the admin to copy: only its
 * SHA-256 is stored.
 */
export async function createKeyAction(raw: unknown): Promise<AdminResult<{ secret: string; prefix: string }>> {
  const ready = await authorizeAction("admin", newKeySchema, raw);
  if (!ready.ok) return ready;
  const key = await createApiKey({ ...ready.data, createdById: ready.user.id });
  return { ok: true, secret: key.secret, prefix: key.prefix };
}

const keyIdSchema = z.strictObject({ id: z.string().min(1).max(64) });

/** Revokes a key at once: the next request with it gets 401 (admin only). */
export async function revokeKeyAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", keyIdSchema, raw);
  if (!ready.ok) return ready;
  const exists = await prisma.apiKey.findUnique({ where: { id: ready.data.id }, select: { id: true } });
  if (!exists) return { ok: false, error: "Esta chave não existe mais." };
  await revokeApiKey(ready.data.id);
  return { ok: true };
}
