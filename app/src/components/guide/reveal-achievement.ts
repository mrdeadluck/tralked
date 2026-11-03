"use server";

import { prisma } from "@/lib/db";

/** Text of one hidden achievement, fetched only when the visitor clicks "mostrar". */
export async function revealAchievement(id: string): Promise<{ name: string; description: string | null } | null> {
  if (typeof id !== "string" || id.length > 64) return null;
  const a = await prisma.achievement.findFirst({ where: { id, hidden: true } });
  if (!a) return null;
  return { name: a.namePt ?? a.name, description: a.descriptionPt ?? a.description };
}
