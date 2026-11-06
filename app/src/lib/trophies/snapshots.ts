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
  "regionalExtras",
  "totalXp",
  "level",
] as const satisfies readonly (keyof UserNumbers)[];
/** The undated part of each Steam number (absent in snapshots from before it existed: 0). */
const UNDATED = { steamUnlocks: "steamUndatedUnlocks", steamXp: "steamUndatedXp" } as const;

const undated = (u: UserNumbers, field: keyof typeof UNDATED) => u[UNDATED[field]] ?? 0;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/**
 * Differences between two snapshots, one line per user and number that changed (users matched by
 * id). `steamChanged`: a Steam number differs beyond its undated part (the Steam unlocks of unknown
 * date that `steam:dateless` adds), or a user with Steam numbers is missing on one side. Growth of
 * the undated part gets its own "Steam sem data" line and sets `steamUndatedChanged`, so after the
 * re-read the Steam difference can be checked to be exactly the undated unlocks.
 */
export function compareSnapshots(
  a: Snapshot,
  b: Snapshot,
): { lines: string[]; steamChanged: boolean; steamUndatedChanged: boolean } {
  const lines: string[] = [];
  let steamChanged = false;
  let steamUndatedChanged = false;
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
      const steam = field === "steamUnlocks" || field === "steamXp";
      // Only the undated part moved: told by the "Steam sem data" line below.
      if (steam && before[field] - undated(before, field) === after[field] - undated(after, field)) continue;
      if (steam) steamChanged = true;
      lines.push(
        `${after.handle}: ${field} ${before[field]} -> ${after[field]} (${signed(after[field] - before[field])})${steam ? "  <- STEAM" : ""}`,
      );
    }
    const [u0, u1] = [undated(before, "steamUnlocks"), undated(after, "steamUnlocks")];
    const [x0, x1] = [undated(before, "steamXp"), undated(after, "steamXp")];
    if (u0 !== u1 || x0 !== x1) {
      steamUndatedChanged = true;
      lines.push(`${after.handle}: Steam sem data: unlocks ${u0} -> ${u1} (${signed(u1 - u0)}), XP ${x0} -> ${x1} (${signed(x1 - x0)})`);
    }
  }
  for (const after of byId.values()) {
    lines.push(`${after.handle}: only in ${b.label}`);
    if (after.steamUnlocks !== 0 || after.steamXp !== 0) steamChanged = true;
  }
  return { lines, steamChanged, steamUndatedChanged };
}
