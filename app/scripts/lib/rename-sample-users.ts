import type { PrismaClient } from "@/generated/prisma/client";
import type { SampleName } from "../../prisma/seed-data/sample-names";

/** Real accounts: never renamed, whatever the list says. */
const PROTECTED_HANDLES = new Set(["lucas", "mrdead", "mrdead_", "diguzz"]);

export type RenameChange = { model: string; id: string; field: string; from: string; to: string };
export type RenameReport = { changes: RenameChange[]; skipped: string[] };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Renames the development data's fictional people from their old names to the new ones
 * (`SAMPLE_NAMES`), on a database seeded before the change. Idempotent: a second run finds nothing
 * to do. Only the seed's own rows are touched:
 *
 * - a player is renamed only when the user with the old handle has the seed's SteamID for that
 *   player (`steamIdOf(index)`); anyone else who happens to use the name is left alone;
 * - an author (byline) is renamed only when it has no account or its account is that seed player;
 * - denormalized copies follow: the seed player's Steam LinkedAccount name and display name, and
 *   notification titles that start with the old name ("@Nome comentou…", "Nome curtiu…").
 *
 * Nothing is renamed onto a handle someone else already has. With `dryRun` the changes are only
 * reported.
 */
export async function renameSampleUsers(
  db: PrismaClient,
  names: readonly SampleName[],
  { dryRun, steamIdOf }: { dryRun: boolean; steamIdOf: (index: number) => string },
): Promise<RenameReport> {
  const changes: RenameChange[] = [];
  const skipped: string[] = [];

  for (const name of names) {
    if (PROTECTED_HANDLES.has(name.previous.toLowerCase()) || PROTECTED_HANDLES.has(name.handle.toLowerCase())) {
      skipped.push(`${name.previous}: protected account, never renamed`);
      continue;
    }
    const planned: RenameChange[] = [];
    let seedUserId: string | null = null;

    if (name.kind === "player") {
      const steamId = steamIdOf(name.index);
      const old = await db.user.findUnique({ where: { handle: name.previous } });
      const current = old ?? (await db.user.findUnique({ where: { handle: name.handle } }));
      if (current && current.steamId !== steamId) {
        skipped.push(`${current.handle}: not the seeded player (SteamID ${current.steamId ?? "none"}), left alone`);
      } else if (current) {
        seedUserId = current.id;
        if (old) {
          planned.push({ model: "User", id: old.id, field: "handle", from: old.handle, to: name.handle });
        }
        if (current.displayName === name.previous) {
          planned.push({ model: "User", id: current.id, field: "displayName", from: current.displayName, to: name.displayName });
        }
        const steam = await db.linkedAccount.findUnique({
          where: { userId_platform: { userId: current.id, platform: "steam" } },
        });
        if (steam && steam.handle === name.previous) {
          planned.push({ model: "LinkedAccount", id: steam.id, field: "handle", from: steam.handle, to: name.displayName });
        }
        const pattern = new RegExp(`^(@?)${escapeRegExp(name.previous)}(?= )`);
        const notifications = await db.notification.findMany({
          where: { OR: [{ title: { startsWith: `${name.previous} ` } }, { title: { startsWith: `@${name.previous} ` } }] },
          select: { id: true, title: true },
        });
        for (const n of notifications) {
          planned.push({ model: "Notification", id: n.id, field: "title", from: n.title, to: n.title.replace(pattern, `$1${name.handle}`) });
        }
      }
      if (old && seedUserId) {
        const taken = await db.user.findUnique({ where: { handle: name.handle }, select: { id: true } });
        if (taken && taken.id !== old.id) {
          skipped.push(`${name.previous}: the handle ${name.handle} already belongs to another user, nothing renamed`);
          continue;
        }
      }
    }

    const author = await db.author.findUnique({ where: { handle: name.previous } });
    if (author) {
      if (author.userId !== null && author.userId !== seedUserId) {
        skipped.push(`author ${author.handle}: belongs to another account, left alone`);
      } else {
        const taken = await db.author.findUnique({ where: { handle: name.handle }, select: { id: true } });
        if (taken) skipped.push(`author ${name.previous}: the byline ${name.handle} already exists, left alone`);
        else planned.push({ model: "Author", id: author.id, field: "handle", from: author.handle, to: name.handle });
      }
    }

    if (planned.length === 0) continue;
    changes.push(...planned);
    if (dryRun) continue;
    await db.$transaction(
      planned.map((c) => {
        switch (c.model) {
          case "User":
            return db.user.update({ where: { id: c.id }, data: { [c.field]: c.to } });
          case "LinkedAccount":
            return db.linkedAccount.update({ where: { id: c.id }, data: { handle: c.to } });
          case "Notification":
            return db.notification.update({ where: { id: c.id }, data: { title: c.to } });
          default:
            return db.author.update({ where: { id: c.id }, data: { handle: c.to } });
        }
      }),
    );
  }
  return { changes, skipped };
}
