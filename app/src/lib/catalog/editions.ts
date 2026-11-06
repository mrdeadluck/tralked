import { prisma } from "@/lib/db";

/** A pair is stored once, smaller id first; a game is never an edition of itself. */
export function editionPair(a: string, b: string): { gameId: string; otherId: string } {
  if (a === b) throw new Error("a game is not an edition of itself");
  return a < b ? { gameId: a, otherId: b } : { gameId: b, otherId: a };
}

export async function linkEditions(a: string, b: string): Promise<void> {
  await prisma.gameEdition.createMany({ data: [editionPair(a, b)], skipDuplicates: true });
}
