import { z } from "zod";
import { containsHtml, HTML_MESSAGE, normalizeText } from "@/lib/community/text";
import { prisma } from "@/lib/db";
import { BIO_MAX } from "./limits";

export { BIO_MAX, DELETE_CONFIRMATION } from "./limits";

/** Profile settings form: plain-text bio (optional, at most 280 characters) and visibility. */
export const profileSettingsSchema = z.object({
  bio: z
    .string()
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .max(BIO_MAX, `A bio pode ter no máximo ${BIO_MAX} caracteres.`)
        .refine((value) => !containsHtml(value), HTML_MESSAGE),
    ),
  profilePublic: z.boolean(),
});

export type ProfileSettings = z.output<typeof profileSettingsSchema>;

/** Saves the settings; returns whether the profile visibility changed (cached pages must follow). */
export async function updateProfileSettings(
  userId: string,
  settings: ProfileSettings,
): Promise<{ visibilityChanged: boolean }> {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { profilePublic: true } });
  await prisma.user.update({
    where: { id: userId },
    data: { bio: settings.bio === "" ? null : settings.bio, profilePublic: settings.profilePublic },
  });
  return { visibilityChanged: before !== null && before.profilePublic !== settings.profilePublic };
}
