/**
 * Adds the curated Entretenimento / Tecnologia headline feeds (src/lib/news/feed-catalog.ts) to a
 * database, active, so the hourly `news` cron starts reading them. Idempotent: feeds already
 * registered (same URL) are never changed, so the admin's choices in /admin/feeds stay.
 *
 *   DATABASE_URL=postgresql://... pnpm news:feeds --dry-run    # lists what would be added
 *   DATABASE_URL=postgresql://... pnpm news:feeds              # adds them, active
 *   DATABASE_URL=postgresql://... pnpm news:feeds --paused     # adds them paused (admin activates)
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, paused: { type: "boolean", default: false } },
});
const dryRun = values["dry-run"];
const active = !values.paused;

const db = requireDatabaseUrl();
const log = createRunLog("news-feeds");

const { prisma } = await import("@/lib/db");
const { RECOMMENDED_FEEDS } = await import("@/lib/news/feed-catalog");
const { addRecommendedFeeds } = await import("./lib/news-feeds");

try {
  log.info(`${dryRun ? "Dry run on" : "Adding headline feeds to"} ${db.name} (${active ? "active" : "paused"})…`);
  const { added, kept } = await addRecommendedFeeds(prisma, RECOMMENDED_FEEDS, { dryRun, active });
  for (const f of added) log.info(`${dryRun ? "would add" : "added"} [${f.area}] ${f.name} ${f.url}`);
  for (const k of kept) log.info(`already registered, unchanged: [${k.area}] ${k.feed.name} (${k.active ? "active" : "paused"})`);
  log.info(`${added.length} feed(s) ${dryRun ? "to add" : "added"}, ${kept.length} already registered. Log: ${log.file}`);
} catch (error) {
  log.error("Adding feeds failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
