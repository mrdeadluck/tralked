/**
 * Fills the catalog with the most popular Steam games, from public endpoints (no API key):
 * SteamSpy's top lists plus its most-owned page (most owned first), the store page in pt-BR, Steam library art,
 * screenshots and trailers (hotlinked, never downloaded), achievements from a public reference
 * profile plus their global percentages, and skills from SteamSpy tags.
 *
 *   DATABASE_URL=postgresql://... pnpm catalog:bootstrap --limit 300 [--concurrency 3] [--only-top]
 *
 * --limit is the number of popular games wanted in the catalog: apps without achievements (or
 * that are not games) are skipped and the next most owned ones taken instead. Games already in
 * the catalog (e.g. the seed's) are completed too, unless --only-top.
 *
 * Polite: at most one request per host every 1.2 s (store 1.5 s), Tralked User-Agent, backoff on
 * 429/5xx. Resumable: games already complete in the database are skipped. Progress goes to the
 * console and to scripts/.logs/.
 */
import { parseArgs } from "node:util";
import { createRunLog, forEachLimited, formatDuration, requireDatabaseUrl } from "./lib/run";
import type { CatalogMedia } from "./lib/write-catalog-game";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "300" },
    concurrency: { type: "string", default: "3" },
    reference: { type: "string" },
    /** Leave the games already in the catalog (e.g. the seed's) as they are. */
    "only-top": { type: "boolean", default: false },
  },
});
const limit = Number(values.limit);
const concurrency = Math.max(1, Math.min(6, Number(values.concurrency)));
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");

const db = requireDatabaseUrl();
const log = createRunLog("catalog-bootstrap");

// Imported after the DATABASE_URL check: the Prisma client reads it on import.
const { prisma } = await import("@/lib/db");
const { createSteamCommunity, DEFAULT_REFERENCE_STEAM_ID } = await import("@/lib/integrations/steam/community");
const { createPoliteFetch } = await import("@/lib/integrations/steam/polite-fetch");
const { fetchStoreApp, libraryAssetUrls } = await import("@/lib/integrations/steam/store");
const { fetchMostOwnedPage, fetchTags, fetchTopList, rankByOwners, TOP_LISTS } = await import(
  "@/lib/integrations/steam/steamspy"
);
const { mapTagsToSkills } = await import("@/lib/integrations/steam/tags-map");
const { completedAppIds, writeCatalogGame } = await import("./lib/write-catalog-game");

const politeFetch = createPoliteFetch({
  hostIntervalsMs: { "store.steampowered.com": 1_500 },
  onRetry: ({ url, attempt, waitMs, reason }) =>
    log.warn(`retry ${attempt} in ${Math.round(waitMs / 1000)}s after ${reason}: ${url}`),
});
const steam = createSteamCommunity({
  fetch: politeFetch,
  referenceSteamId: values.reference ?? DEFAULT_REFERENCE_STEAM_ID,
});

/** True when the CDN serves the file (library art is missing for some apps). */
async function exists(url: string): Promise<boolean> {
  const res = await politeFetch(url, { method: "HEAD" });
  return res.ok;
}

type Outcome = "created" | "updated" | "skipped" | "failed";
const counts: Record<Outcome, number> = { created: 0, updated: 0, skipped: 0, failed: 0 };
const failedEndpoints: string[] = [];

async function importApp(appId: number, label: string): Promise<Outcome> {
  const store = await fetchStoreApp(politeFetch, appId);
  if (!store) {
    log.warn(`${label}: not on the store, skipped`);
    return "skipped";
  }
  if (store.type !== "game") {
    log.warn(`${label}: store type "${store.type}", skipped`);
    return "skipped";
  }
  if (store.achievementCount === 0) {
    log.info(`${label}: no Steam achievements, skipped`);
    return "skipped";
  }
  const schema = await steam.getSchemaForGame(appId);
  if (schema.length === 0) {
    log.warn(`${label}: the store lists ${store.achievementCount} achievements but the reference page has none, skipped`);
    return "skipped";
  }
  const [percentages, tags] = await Promise.all([
    steam.getGlobalAchievementPercentages(appId),
    fetchTags(politeFetch, appId).catch((error: unknown) => {
      log.error(`${label}: SteamSpy tags failed (no skills)`, error);
      failedEndpoints.push(`steamspy appdetails ${appId}`);
      return {};
    }),
  ]);

  const media: CatalogMedia[] = [];
  const library = libraryAssetUrls(appId);
  for (const kind of ["cover", "hero", "logo"] as const) {
    const asset = library[kind];
    if (await exists(asset.url)) media.push({ kind, order: 0, ...asset });
  }
  if (store.headerUrl) media.push({ kind: "artwork", order: 0, url: store.headerUrl, width: 460, height: 215 });
  store.screenshots.forEach((s, order) => media.push({ kind: "screenshot", order, ...s }));
  let videoOrder = 0;
  for (const trailer of store.trailers) {
    if (await exists(trailer.url)) media.push({ kind: "video", order: videoOrder++, url: trailer.url });
    else log.info(`${label}: trailer ${trailer.id} is stream-only (no mp4), skipped`);
    if (videoOrder === 2) break;
  }

  const skills = mapTagsToSkills(tags);
  const { game, created } = await writeCatalogGame({ appId, store, schema, percentages, skills, media });
  const rated = schema.filter((a) => percentages[a.apiName] !== undefined).length;
  log.info(
    `${label}: ${created ? "created" : "updated"} /jogos/${game.slug} — ${schema.length} achievements (${rated} with %), ` +
      `${media.length} media, skills [${skills.join(", ")}]`,
  );
  return created ? "created" : "updated";
}

const started = Date.now();
log.info(`Catalog bootstrap into database "${db.name}" (limit ${limit}, concurrency ${concurrency}). Log: ${log.file}`);

const lists = [];
for (const list of TOP_LISTS) {
  try {
    lists.push(await fetchTopList(politeFetch, list));
  } catch (error) {
    log.error(`SteamSpy ${list} failed`, error);
    failedEndpoints.push(`steamspy ${list}`);
  }
}
// The three top lists currently answer the same 100 apps: the most-owned page fills the rest.
try {
  lists.push(await fetchMostOwnedPage(politeFetch, 0));
} catch (error) {
  log.error("SteamSpy most-owned page failed", error);
  failedEndpoints.push("steamspy all page 0");
}
const ranked: { appId: number; name: string }[] = rankByOwners(lists);
const done = await completedAppIds();
log.info(`${ranked.length} ranked apps from ${lists.length} SteamSpy lists; ${done.size} games already complete`);

/** Popular games in the catalog so far (complete before this run, or written by it). */
let popular = 0;
async function processApp(app: { appId: number; name: string }, label: string, countsTowardLimit: boolean) {
  if (done.has(app.appId)) {
    counts.skipped++;
    if (countsTowardLimit) popular++;
    return;
  }
  try {
    const outcome = await importApp(app.appId, label);
    counts[outcome]++;
    if (countsTowardLimit && outcome !== "skipped") popular++;
  } catch (error) {
    counts.failed++;
    failedEndpoints.push(`app ${app.appId}`);
    log.error(`${label}: failed, will be retried on the next run`, error);
  }
}

const seen = new Set<number>();
await forEachLimited(
  ranked,
  concurrency,
  async (app, index) => {
    seen.add(app.appId);
    await processApp(app, `[#${index + 1}, ${popular}/${limit}] ${app.name} (${app.appId})`, true);
  },
  () => popular >= limit,
);

if (!values["only-top"]) {
  // Games already in the catalog (the seed's, older imports) get real data too.
  const existing = await prisma.game.findMany({
    where: { steamAppId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { steamAppId: true, name: true },
  });
  const extra = existing.flatMap((g) =>
    g.steamAppId !== null && !seen.has(g.steamAppId) ? [{ appId: g.steamAppId, name: g.name }] : [],
  );
  await forEachLimited(extra, concurrency, (app, index) =>
    processApp(app, `[catalog ${index + 1}/${extra.length}] ${app.name} (${app.appId})`, false),
  );
}

const [games, achievements, media] = await Promise.all([
  prisma.game.count({ where: { steamAppId: { not: null } } }),
  prisma.achievement.count({ where: { platform: "steam" } }),
  prisma.gameMedia.count({ where: { source: "steam" } }),
]);
log.info(
  `Done in ${formatDuration(Date.now() - started)}: ${popular} popular games in the catalog; ` +
    `created ${counts.created}, updated ${counts.updated}, ` +
    `skipped ${counts.skipped}, failed ${counts.failed}. Database now has ${games} Steam games, ` +
    `${achievements} Steam achievements, ${media} Steam media rows.`,
);
if (failedEndpoints.length > 0) log.warn(`Failures: ${failedEndpoints.join("; ")}`);
await prisma.$disconnect();
