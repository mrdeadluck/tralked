/**
 * Imports a public Steam profile the way a Steam login + first sync would, without the login:
 * creates (or refreshes) the user by SteamID64, links the Steam account and runs the regular
 * sync. Without an API key the sync probes the catalog's games one by one (run the catalog
 * bootstrap first), keeping games with at least one unlock and Steam's real unlock times.
 *
 *   DATABASE_URL=postgresql://... pnpm steam:import <id64|vanity> [--admin] [--verified] [--psn <onlineId>]
 *
 * --admin     role `admin` (implies --verified)
 * --verified  marks the Steam LinkedAccount verified (only for the account's owner)
 * --psn       adds a pending PSN LinkedAccount with this online id (activated later through linking)
 */
import { parseArgs } from "node:util";
import { createRunLog, formatDuration, requireDatabaseUrl } from "./lib/run";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    admin: { type: "boolean", default: false },
    verified: { type: "boolean", default: false },
    psn: { type: "string" },
  },
});
const target = positionals[0]?.trim();
if (!target) {
  console.error("Usage: pnpm steam:import <id64|vanity> [--admin] [--verified] [--psn <onlineId>]");
  process.exit(2);
}
const verified = values.admin || values.verified;

const db = requireDatabaseUrl();
const log = createRunLog("steam-import");

const { prisma } = await import("@/lib/db");
const { getSteam } = await import("@/lib/integrations");
const { steamMode } = await import("@/lib/integrations/steam");
const { createSteamCommunity } = await import("@/lib/integrations/steam/community");
const { upsertUserFromSteam } = await import("@/lib/auth/upsert-user");
const { syncUser } = await import("@/lib/sync/user");

const mode = steamMode();
if (mode === "fixture") {
  log.error("STEAM_MODE=fixture would import fixture data; unset it (community) or set STEAM_API_KEY.");
  process.exit(2);
}

const started = Date.now();
log.info(`Steam import of "${target}" into database "${db.name}" (Steam mode: ${mode}). Log: ${log.file}`);

const steamId = /^\d{17}$/.test(target) ? target : await createSteamCommunity().resolveVanity(target);
if (!steamId) {
  log.error(`No Steam profile at /id/${target}`);
  process.exit(1);
}

const summary = await getSteam().getPlayerSummary(steamId);
if (!summary.profilePublic) {
  log.error(`${summary.personaName} (${steamId}) is not public: nothing can be imported.`);
  process.exit(1);
}

// Same path as a Steam login, so a later real login lands on this very user.
const user = await upsertUserFromSteam(steamId);
if (values.admin && user.role !== "admin") {
  await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
}
log.info(`User @${user.handle} (${user.id})${values.admin ? ", role admin" : ""}`);

const steamAccount = await prisma.linkedAccount.findUnique({
  where: { userId_platform: { userId: user.id, platform: "steam" } },
});
if (steamAccount) {
  await prisma.linkedAccount.update({
    where: { id: steamAccount.id },
    // Never downgrades: an already verified account stays verified.
    data: { handle: summary.personaName, ...(verified && !steamAccount.verifiedAt && { verifiedAt: new Date() }) },
  });
} else {
  await prisma.linkedAccount.create({
    data: {
      userId: user.id,
      platform: "steam",
      externalId: steamId,
      handle: summary.personaName,
      verifiedAt: verified ? new Date() : null,
    },
  });
}
log.info(`Steam account linked ${verified ? "and verified" : "(not verified)"}`);

if (values.psn) {
  const existing = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId: user.id, platform: "psn" } },
  });
  if (existing) {
    log.info(`PSN account already present (${existing.handle}, ${existing.verifiedAt ? "verified" : "pending"}), left as is`);
  } else {
    // The PSN accountId is only known once PSN access is configured (PSN_NPSSO) and the link is
    // confirmed; until then the row is pending (no verifiedAt) with a placeholder id.
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId: `pending:${values.psn}`, handle: values.psn },
    });
    log.info(`PSN account ${values.psn} added as pending`);
  }
}

const candidates = await prisma.game.count({ where: { steamAppId: { not: null }, achievementCount: { gt: 0 } } });
log.info(
  mode === "community"
    ? `Syncing: probing up to ${candidates} catalog games (about ${Math.ceil((candidates * 1.2) / 60)} min)…`
    : "Syncing through the Steam Web API…",
);
const result = await syncUser(user.id);
log.info(`Sync ${result.status}: ${result.newUnlocks} new unlocks, level ${result.levelBefore} → ${result.levelAfter}`);

const [stats, skills, games, unlocks] = await Promise.all([
  prisma.userStats.findUnique({ where: { userId: user.id } }),
  prisma.skillProgress.findMany({ where: { userId: user.id }, orderBy: [{ level: "desc" }, { points: "desc" }] }),
  prisma.userGame.findMany({
    where: { userId: user.id, platform: "steam", unlockedCount: { gt: 0 } },
    include: { game: { select: { name: true, achievementCount: true } } },
    orderBy: { unlockedCount: "desc" },
  }),
  prisma.userAchievement.count({ where: { userId: user.id } }),
]);
log.info(`Level ${stats?.level ?? 1}, ${stats?.totalXp ?? 0} XP, ${unlocks} unlocks in ${games.length} games`);
log.info(`Skills: ${skills.map((s) => `${s.skill} ${s.level}`).join(", ") || "none"}`);
for (const g of games) {
  log.info(`  ${g.game.name}: ${g.unlockedCount}/${g.game.achievementCount}${g.completedAt ? " (100%)" : ""}`);
}
log.info(`Done in ${formatDuration(Date.now() - started)}`);
await prisma.$disconnect();
