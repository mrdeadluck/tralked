import type { Metadata } from "next";
import type { User } from "@/generated/prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { PlayerHeader } from "@/lib/queries/players";

/**
 * Who may see a profile (the character sheet and its sections): anyone when the profile is public,
 * the owner always. A private profile shows visitors its name only. Visibility is read fresh (not
 * from the cached header), so making a profile private hides it at once, also when the change came
 * from a sync outside Next (the GitHub import worker), which cannot refresh the cached header.
 */
export async function profileAccess(
  header: PlayerHeader,
): Promise<{ viewer: User | null; isOwner: boolean; visible: boolean }> {
  const [viewer, user] = await Promise.all([
    getSessionUser(),
    prisma.user.findUnique({ where: { id: header.id }, select: { profilePublic: true } }),
  ]);
  const isOwner = viewer?.id === header.id;
  return { viewer, isOwner, visible: isOwner || user?.profilePublic === true };
}

/** Metadata of a profile section ("Jogos de Fulano"); private profiles are not indexed. */
export function sectionMetadata(header: PlayerHeader | null, title: string, path: string, description: string): Metadata {
  if (!header) return { title: "Jogador não encontrado | Tralked", robots: { index: false } };
  if (!header.profilePublic) {
    return { title: `${title} de @${header.handle} | Tralked`, robots: { index: false, follow: false } };
  }
  return {
    title: `${title} de ${header.displayName} (@${header.handle}) | Tralked`,
    description,
    alternates: { canonical: `/jogador/${header.handle}${path}` },
  };
}
