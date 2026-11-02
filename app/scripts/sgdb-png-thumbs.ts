/**
 * Marks the stored SteamGridDB art whose thumbnail exists only in PNG (transparent images) with
 * the `#png-thumb` fragment (lib/images/sized PNG_THUMB_HINT), so pages request that thumbnail
 * directly instead of a JPEG one that 404s (one failed request per page that shows the art). New
 * art gets the mark from the sync (lib/integrations/sgdb/client); this covers rows stored before.
 * Checks each PNG original's JPEG thumbnail once (HEAD, no API key); idempotent.
 *
 *   DATABASE_URL=postgresql://... pnpm sgdb:png-thumbs --dry-run   # lists what would change
 *   DATABASE_URL=postgresql://... pnpm sgdb:png-thumbs             # writes
 */
import { parseArgs } from "node:util";
import { createRunLog, requireDatabaseUrl } from "./lib/run";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const db = requireDatabaseUrl();
const log = createRunLog("sgdb-png-thumbs");

const { prisma } = await import("@/lib/db");
const { PNG_THUMB_HINT } = await import("@/lib/images/sized");

const PNG_ORIGINAL = /^https:\/\/cdn2\.steamgriddb\.com\/(hero|grid)\/([0-9a-f]+)\.png$/;
const status = async (url: string) => (await fetch(url, { method: "HEAD" })).status;

/** True when the art's JPEG thumbnail is missing and the PNG one exists. */
const checked = new Map<string, boolean>();
async function pngOnly(url: string): Promise<boolean> {
  const match = url.match(PNG_ORIGINAL);
  if (!match) return false;
  if (checked.has(url)) return checked.get(url)!;
  const folder = match[1] === "hero" ? "hero_thumb" : "thumb";
  const base = `https://cdn2.steamgriddb.com/${folder}/${match[2]}`;
  const result = (await status(`${base}.jpg`)) === 404 && (await status(`${base}.png`)) === 200;
  checked.set(url, result);
  return result;
}

try {
  log.info(`${dryRun ? "Dry run on" : "Marking PNG-only thumbnails in"} ${db.name}…`);
  const sgdb = { contains: "cdn2.steamgriddb.com/", endsWith: ".png" };
  const games = await prisma.game.findMany({
    where: { OR: [{ coverUrl: sgdb }, { heroUrl: sgdb }] },
    select: { id: true, slug: true, coverUrl: true, heroUrl: true },
  });
  let changed = 0;
  for (const game of games) {
    const data: { coverUrl?: string; heroUrl?: string } = {};
    if (game.coverUrl && (await pngOnly(game.coverUrl))) data.coverUrl = game.coverUrl + PNG_THUMB_HINT;
    if (game.heroUrl && (await pngOnly(game.heroUrl))) data.heroUrl = game.heroUrl + PNG_THUMB_HINT;
    if (Object.keys(data).length === 0) continue;
    changed++;
    log.info(`${dryRun ? "would mark" : "marked"} ${game.slug}: ${Object.keys(data).join(", ")}`);
    if (!dryRun) await prisma.game.update({ where: { id: game.id }, data });
  }
  const media = await prisma.gameMedia.findMany({ where: { url: sgdb }, select: { id: true, url: true } });
  for (const row of media) {
    if (!row.url || !(await pngOnly(row.url))) continue;
    changed++;
    log.info(`${dryRun ? "would mark" : "marked"} media ${row.id}`);
    if (!dryRun) await prisma.gameMedia.update({ where: { id: row.id }, data: { url: row.url + PNG_THUMB_HINT } });
  }
  log.info(`${checked.size} PNG original(s) checked, ${changed} row(s) ${dryRun ? "to mark" : "marked"}.`);
  log.info(`Log: ${log.file}`);
} catch (error) {
  log.error("Marking failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
