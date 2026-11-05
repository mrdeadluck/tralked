/**
 * Per-user numbers of the trophy-list migration, taken before and after each phase: Steam unlocks
 * and Steam trophy XP (must never change), PSN/Xbox/RA unlocks, platinums, regional extras, total
 * XP and level (lib/trophies/numbers.ts). Read-only.
 *
 * Production: use the direct URL (DATABASE_URL_UNPOOLED), not the pooled one.
 *
 *   DATABASE_URL=$DATABASE_URL_UNPOOLED pnpm trophy-lists:snapshot --label a-antes
 *       -> C:\Users\luck_\tralked-backups\snapshot-a-antes.json
 *   pnpm trophy-lists:snapshot --compare a-antes a-depois
 *       -> prints the differences (no database); exits 1 when a Steam number differs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { compareSnapshots, type Snapshot } from "@/lib/trophies/snapshots";

const BACKUPS = "C:\\Users\\luck_\\tralked-backups";
const LABEL = /^[\w.-]+$/;
const fileOf = (label: string) => join(BACKUPS, `snapshot-${label}.json`);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { label: { type: "string" }, compare: { type: "boolean", default: false } },
});

if (values.compare) {
  if (positionals.length !== 2 || !positionals.every((l) => LABEL.test(l))) {
    console.error("Usage: trophy-lists:snapshot --compare <label-a> <label-b>");
    process.exit(2);
  }
  const read = (label: string): Snapshot => {
    const file = fileOf(label);
    if (!existsSync(file)) {
      console.error(`No snapshot ${file}.`);
      process.exit(2);
    }
    return JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  };
  const [a, b] = positionals;
  const { lines, steamChanged } = compareSnapshots(read(a), read(b));
  console.log(lines.length > 0 ? lines.join("\n") : "No differences.");
  if (steamChanged) {
    console.error("A Steam number differs: the Steam data must not change.");
    process.exit(1);
  }
  console.log("Steam: identical.");
  process.exit(0);
}

if (!values.label || !LABEL.test(values.label)) {
  console.error("Usage: trophy-lists:snapshot --label <label> (letters, digits, '-', '_', '.')");
  process.exit(2);
}
const label = values.label;

const { requireDatabaseUrl } = await import("./lib/run");
const db = requireDatabaseUrl();
// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { userNumbers } = await import("@/lib/trophies/numbers");
try {
  const users = await userNumbers();
  const snapshot: Snapshot = { label, takenAt: new Date().toISOString(), database: db.name, users };
  mkdirSync(BACKUPS, { recursive: true });
  const file = fileOf(label);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const u of users) {
    console.log(
      `${u.handle}: steam ${u.steamUnlocks} (${u.steamXp} XP), psn ${u.psnUnlocks}, xbox ${u.xboxUnlocks}, ` +
        `retro ${u.retroUnlocks}, platinums ${u.platinums}, regional extras ${u.regionalExtras}, XP ${u.totalXp}, level ${u.level}`,
    );
  }
  console.log(`Snapshot of ${users.length} users written to ${file}.`);
} catch (error) {
  console.error("Snapshot failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
