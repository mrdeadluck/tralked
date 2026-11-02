/**
 * Who may moderate what. Pure functions shared by the server (every action checks them again)
 * and by the islands that decide which controls to render. Hiding a control is never the
 * protection: the Server Actions call these with the role read from the database.
 *
 * - Articles (edit, unpublish, category, highlight): admin and editor.
 * - Community moderation (comments, photos, guides, locks, reports, mutes and bans): admin,
 *   editor and moderator.
 * - Sanctions: nobody sanctions themselves or an admin; only an admin sanctions another staff
 *   member (editor or moderator).
 */

export const MODERATOR_ROLES = ["admin", "editor", "moderator"] as const;

/** Longest reason a moderator may give (characters). */
export const MODERATION_REASON_MAX = 300;

/** Edits, unpublishes and re-files articles (the newsroom). */
export const canEditArticles = (role: string | null | undefined) => role === "admin" || role === "editor";

/** Moderates community content and users. */
export const canModerate = (role: string | null | undefined) =>
  (MODERATOR_ROLES as readonly string[]).includes(role ?? "");

type Person = { id: string; role: string };

/** Whether `actor` may mute or ban `target` (and lift it). */
export function canSanction(actor: Person, target: Person): boolean {
  if (!canModerate(actor.role) || actor.id === target.id) return false;
  if (target.role === "admin") return false;
  if (canModerate(target.role)) return actor.role === "admin";
  return true;
}

/** The sanction columns of User (absent fields count as "no sanction"). */
export type SanctionState = { mutedUntil?: Date | null; bannedUntil?: Date | null };

export const isBanned = (user: SanctionState, now: Date = new Date()) =>
  user.bannedUntil != null && user.bannedUntil.getTime() > now.getTime();

export const isMuted = (user: SanctionState, now: Date = new Date()) =>
  user.mutedUntil != null && user.mutedUntil.getTime() > now.getTime();

const UNTIL_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export const formatUntil = (date: Date) => UNTIL_FORMAT.format(date);

export const bannedMessage = (until: Date) => `Sua conta está suspensa até ${formatUntil(until)}.`;

export const mutedMessage = (until: Date) =>
  `Você está silenciado até ${formatUntil(until)}. Até lá, não pode comentar nem publicar.`;

/**
 * Why `user` may not publish content now (comments, forum posts, photos), or null when they may.
 * A ban also blocks (the session already refuses banned users; this is the second lock).
 */
export function postingBlock(user: SanctionState, now: Date = new Date()): string | null {
  if (isBanned(user, now)) return bannedMessage(user.bannedUntil!);
  if (isMuted(user, now)) return mutedMessage(user.mutedUntil!);
  return null;
}

/** Why `user` may not interact (likes, votes, reports), or null. Only a ban blocks. */
export function interactionBlock(user: SanctionState, now: Date = new Date()): string | null {
  return isBanned(user, now) ? bannedMessage(user.bannedUntil!) : null;
}
