/**
 * One-off repair: sets every Article.comments to the number of visible comments of that article.
 * Safe to run on a live database at any time (it only updates counters that differ, never
 * deletes). The app keeps the counter in sync on every comment create, delete and moderation.
 *
 *   DATABASE_URL=postgresql://... pnpm comments:recount
 */
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const db = requireDatabaseUrl();
const log = createRunLog("comments-recount");

const { prisma } = await import("@/lib/db");
const { recountAllArticleComments } = await import("@/lib/community/comments");

const started = Date.now();
try {
  log.info(`Recounting article comments in ${db.name}…`);
  const changed = await recountAllArticleComments(prisma);
  log.info(`Done in ${formatDuration(Date.now() - started)}: ${changed} article(s) updated.`);
} catch (error) {
  log.error("Recount failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
