import type { UserNumbers } from "./numbers";

/** A `trophy-lists:snapshot` file. */
export type Snapshot = { label: string; takenAt: string; database: string; users: UserNumbers[] };

const FIELDS = [
  "steamUnlocks",
  "steamXp",
  "psnUnlocks",
  "xboxUnlocks",
  "retroUnlocks",
  "platinums",
  "psnPlatinums",
  "totalXp",
  "level",
] as const satisfies readonly (keyof UserNumbers)[];
const STEAM_FIELDS = new Set<string>(["steamUnlocks", "steamXp"]);

/**
 * Differences between two snapshots, one line per user and number that changed (users matched by
 * id). `steamChanged`: a Steam number differs, or a user with Steam numbers is missing on one side.
 */
export function compareSnapshots(a: Snapshot, b: Snapshot): { lines: string[]; steamChanged: boolean } {
  const lines: string[] = [];
  let steamChanged = false;
  const byId = new Map(b.users.map((u) => [u.userId, u]));
  for (const before of a.users) {
    const after = byId.get(before.userId);
    byId.delete(before.userId);
    if (!after) {
      lines.push(`${before.handle}: only in ${a.label}`);
      if (before.steamUnlocks !== 0 || before.steamXp !== 0) steamChanged = true;
      continue;
    }
    for (const field of FIELDS) {
      if (before[field] === after[field]) continue;
      // A number one snapshot does not have (taken by older code): no delta.
      if (before[field] === undefined || after[field] === undefined) {
        lines.push(`${after.handle}: ${field} ${before[field] ?? "—"} -> ${after[field] ?? "—"}`);
        continue;
      }
      const steam = STEAM_FIELDS.has(field);
      if (steam) steamChanged = true;
      const delta = after[field] - before[field];
      lines.push(
        `${after.handle}: ${field} ${before[field]} -> ${after[field]} (${delta > 0 ? "+" : ""}${delta})${steam ? "  <- STEAM" : ""}`,
      );
    }
  }
  for (const after of byId.values()) {
    lines.push(`${after.handle}: only in ${b.label}`);
    if (after.steamUnlocks !== 0 || after.steamXp !== 0) steamChanged = true;
  }
  return { lines, steamChanged };
}
