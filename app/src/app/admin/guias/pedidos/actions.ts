"use server";

import { z } from "zod";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import {
  bumpPriority,
  cancelRequest,
  createGuideRequest,
  GuideRequestError,
  retryNow,
} from "@/lib/guide-requests/queue";

/** An appid, or a Steam store link (`.../app/367520/...`). */
const steamRef = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const id = /^\d{1,9}$/.test(value) ? value : /\/app\/(\d{1,9})(?:[/?#]|$)/.exec(value)?.[1];
    if (!id || Number(id) <= 0) {
      ctx.addIssue({ code: "custom", message: "Informe o appid da Steam ou o link da página do jogo na loja." });
      return z.NEVER;
    }
    return Number(id);
  });

const newRequestSchema = z.object({ steam: steamRef, update: z.boolean().optional() });
const idSchema = z.object({ id: z.string().min(1).max(100) });
const bumpSchema = idSchema.extend({ delta: z.union([z.literal(1), z.literal(-1)]) });
const searchSchema = z.object({ q: z.string().trim().min(2).max(100) });

const refused = (error: unknown): { ok: false; error: string } => {
  if (error instanceof GuideRequestError) return { ok: false, error: error.message };
  console.error("Guide request failed", error);
  return { ok: false, error: "Não foi possível consultar a Steam agora. Tente de novo em instantes." };
};

/** Asks for the guide of a game (editor or admin). The game is imported from Steam if it is new. */
export async function createGuideRequestAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", newRequestSchema, raw);
  if (!ready.ok) return ready;
  try {
    await createGuideRequest({ steamAppId: ready.data.steam, requestedById: ready.user.id, update: ready.data.update });
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

export async function retryRequestAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", idSchema, raw);
  if (!ready.ok) return ready;
  try {
    return (await retryNow(ready.data.id)) ? { ok: true } : { ok: false, error: "Este pedido não pode voltar para a fila." };
  } catch (error) {
    return refused(error);
  }
}

export async function cancelRequestAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", idSchema, raw);
  if (!ready.ok) return ready;
  return (await cancelRequest(ready.data.id)) ? { ok: true } : { ok: false, error: "Este pedido já terminou." };
}

export async function bumpPriorityAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("staff", bumpSchema, raw);
  if (!ready.ok) return ready;
  return (await bumpPriority(ready.data.id, ready.data.delta)) ? { ok: true } : { ok: false, error: "Pedido não encontrado." };
}

/** Catalog search for the request form: games on Steam by name. */
export async function searchCatalogAction(raw: unknown): Promise<AdminResult<{ games: { steamAppId: number; name: string }[] }>> {
  const ready = await authorizeAction("staff", searchSchema, raw);
  if (!ready.ok) return ready;
  const rows = await prisma.game.findMany({
    where: { steamAppId: { not: null }, stub: false, name: { contains: ready.data.q, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 8,
    select: { steamAppId: true, name: true },
  });
  return { ok: true, games: rows.flatMap((g) => (g.steamAppId === null ? [] : [{ steamAppId: g.steamAppId, name: g.name }])) };
}
