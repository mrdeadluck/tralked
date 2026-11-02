import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { orderPlatformIds, type PcSpecs } from "./catalog";
import { readPcSpecs, type PlayerSetupInput } from "./schema";

/** The player's setup as shown: known platform ids in catalog order and the filled spec fields. */
export type PlayerSetup = { platforms: string[]; pc: PcSpecs | null };

export const EMPTY_SETUP: PlayerSetup = { platforms: [], pc: null };

export function isSetupEmpty(setup: PlayerSetup): boolean {
  return setup.platforms.length === 0 && setup.pc === null;
}

export async function getPlayerSetup(userId: string): Promise<PlayerSetup> {
  const row = await prisma.playerSetup.findUnique({ where: { userId }, select: { platforms: true, pc: true } });
  if (!row) return EMPTY_SETUP;
  return { platforms: orderPlatformIds(row.platforms), pc: readPcSpecs(row.pc) };
}

/** Saves the validated setup; an empty one deletes the row (nothing stored for nothing). */
export async function savePlayerSetup(userId: string, setup: PlayerSetupInput): Promise<void> {
  if (isSetupEmpty(setup)) {
    await prisma.playerSetup.deleteMany({ where: { userId } });
    return;
  }
  const pc = setup.pc ? (setup.pc as Prisma.InputJsonObject) : Prisma.DbNull;
  await prisma.playerSetup.upsert({
    where: { userId },
    create: { userId, platforms: setup.platforms, pc },
    update: { platforms: setup.platforms, pc },
  });
}
