import type { Db } from "@/lib/community/limits";
import { notify, preview } from "@/lib/community/notify";
import { blockedEitherWay } from "./relations";

/** At most this many people are notified per text (the first distinct @handles). */
export const MAX_MENTIONS = 5;

// "@handle" not glued to a word or e-mail before it; handles are 3–20 of [A-Za-z0-9_].
const MENTION = /(?<![\w@.])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

/** Distinct @handles in a text (lower case), in order, at most MAX_MENTIONS. */
export function parseMentions(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const handle = match[1].toLowerCase();
    if (!seen.includes(handle)) seen.push(handle);
    if (seen.length >= MAX_MENTIONS) break;
  }
  return seen;
}

/**
 * Notifies the users @mentioned in a new comment or post ("mention"). Skips the author, users
 * listed in `skip` (already notified as the replied-to author), and anyone in a block with the
 * author either way. Returns who was notified.
 */
export async function notifyMentions(
  db: Db,
  input: { authorId: string; authorHandle: string; text: string; href: string; skip?: (string | null)[] },
): Promise<string[]> {
  const handles = parseMentions(input.text);
  if (handles.length === 0) return [];
  const users = await db.user.findMany({
    where: { OR: handles.map((handle) => ({ handle: { equals: handle, mode: "insensitive" as const } })) },
    select: { id: true },
  });
  const blocked = await blockedEitherWay(db, input.authorId);
  const notified: string[] = [];
  for (const user of users) {
    if (user.id === input.authorId || blocked.has(user.id) || input.skip?.includes(user.id)) continue;
    await notify(db, {
      userId: user.id,
      actorId: input.authorId,
      kind: "mention",
      title: `@${input.authorHandle} mencionou você`,
      body: preview(input.text),
      href: input.href,
    });
    notified.push(user.id);
  }
  return notified;
}
