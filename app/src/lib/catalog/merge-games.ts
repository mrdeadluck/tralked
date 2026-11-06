import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { playtimeGameId, playtimeSourceKey, reachedMilestones } from "@/lib/engine/playtime";
import { isListPlatform, LIST_PLATFORMS, planListXp, platinumGameId, settleListXp } from "@/lib/progression/list-xp";
import { recomputeUser } from "@/lib/progression/recompute";
import { GAME_REFS } from "./duplicates";
import { editionPair } from "./editions";
import { aliasDroppedIgdbId, moveIgdbAliases } from "./igdb-aliases";

/**
 * Joins a duplicate catalog game (`drop`) into the one that stays (`keep`), in one transaction:
 * every row that points at the drop (GAME_REFS, checked against the schema by a test) moves or is
 * folded into the keep's, the drop's slug becomes a redirect, and the XP ledger keys that name the
 * drop are re-keyed so nothing is paid twice and nothing already paid is lost. Approved pairs only
 * (docs/relatorios/duplicados-*-aprovado.json, `pnpm games:merge`).
 */

type Db = Prisma.TransactionClient | PrismaClient;
type Game = Prisma.GameGetPayload<{ include: { guide: { select: { id: true } } } }>;
type LedgerRow = Prisma.XpLedgerEntryGetPayload<object>;

const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

/** A join the rules never make: both games on Steam, both with a guide, a game with itself. */
export class MergeRefused extends Error {
  constructor(readonly reason: string) {
    super(`Junção recusada: ${reason}`);
    this.name = "MergeRefused";
  }
}

export type MergeReport = {
  /**
   * Rows of the drop handled, by GAME_REFS key (moved to the keep or folded into the keep's row),
   * plus `ledger`: the drop's `platinum` / `playtime` ledger entries, and `platinumCollisions`: valid
   * platinums of the drop whose key on the keep is already taken (rekeyLedger finds them another
   * slot or refuses). A real run adds `ledgerKept`: hours milestones that stay valid under the
   * drop's key (see rekeyLedger).
   */
  moved: Record<string, number>;
  /**
   * A platinum collision the join will most likely refuse: a Steam one (key = gameId) or a legacy
   * `psn:<gameId>` one (written before trophy lists), which no list platinum of the keep can take.
   * A dry run cannot be sure (the free slots are known only once the rows moved); the real run
   * decides.
   */
  likelyRefused: boolean;
  /** Users whose ledger was settled and who were recomputed (a dry run: who would be). */
  usersRecomputed: string[];
  /** Old slugs that now lead to the keep: the drop's own and the redirects that pointed at the drop. */
  redirects: string[];
  keepSlug: string;
};

export type MergeOptions = {
  dryRun?: boolean;
  now?: Date;
  /**
   * recomputeUser of the affected users after the transaction (default true). A batch of joins
   * passes false and recomputes each user once at the end (`pnpm games:merge`).
   */
  recompute?: boolean;
};

/**
 * Joins `dropId` into `keepId` (see the file header). What happens to each table:
 * - GamePlatformLink, TrophyList (catalog lists nobody holds included), Achievement, Guide,
 *   GuideRequest, Article.gameId, ExternalNews, ForumThread, Photo: move;
 * - GameMedia moves without a url (or video) the keep already has; GameSkill is the union;
 *   WishlistItem, GameOpen and ArticleGame keep one row per key; GameRelease keeps the keep's per
 *   platform; SteamPlayerCount moves when the keep has none;
 * - UserGame, per user and platform: hours added, earliest completion, latest play, highest
 *   two-week hours, the keep's checkedPlaytimeMin / playtimePaidMin; then the unlock count of every
 *   keep row of every affected user is recounted (unlocks may arrive without a drop row);
 * - GameOpen keeps the earliest openedAt of the two;
 * - GameEdition pairs of the drop become pairs of the keep (stored once, never a self-pair);
 * - GameSlugRedirect: the redirects to the drop now lead to the keep, and drop.slug -> keep;
 * - GameIgdbAlias: the drop's aliases move to the keep, and the drop's own igdbId becomes one
 *   (unless the keep inherits it), so the IGDB imports never create the drop again;
 * - the keep inherits the ids, texts and art it lacks (steamAppId cleared on the drop first), and
 *   the drop's name and aliases become aliases; the drop is deleted;
 * - ledger: see rekeyLedger (settleListXp of every affected user on PSN/Xbox/RA), and after the
 *   transaction recomputeUser of each (unless `recompute: false`).
 * A missing GAME_REFS table aborts (it is never "nothing to move"). `dryRun` only reads: the same
 * checks and refusals, and the counts of what would move.
 */
export async function mergeGames(keepId: string, dropId: string, options: MergeOptions = {}): Promise<MergeReport> {
  const now = options.now ?? new Date();
  if (keepId === dropId) throw new MergeRefused("um jogo não se junta a ele mesmo");
  if (options.dryRun) return (await prepare(prisma, keepId, dropId)).report;
  const report = await prisma.$transaction(async (tx) => {
    // Rows that would reference either game wait for the join (an FK check locks the game row).
    await tx.$queryRaw`SELECT id FROM "Game" WHERE id = ANY(${[keepId, dropId]}::text[]) FOR UPDATE`;
    const { keep, drop, report, ledger } = await prepare(tx, keepId, dropId);
    await moveRows(tx, keep, drop, report.usersRecomputed);
    report.moved.ledgerKept = await rekeyLedger(tx, keepId, ledger, report.usersRecomputed, now);
    await assertNothingLeft(tx, dropId);
    await inheritGame(tx, keep, drop);
    await tx.game.delete({ where: { id: dropId } });
    return report;
  }, TRANSACTION_OPTIONS);
  if (options.recompute ?? true) for (const userId of report.usersRecomputed) await recomputeUser(userId, now);
  return report;
}

async function prepare(db: Db, keepId: string, dropId: string) {
  await assertGameRefTables(db);
  const [keep, drop] = await Promise.all([loadGame(db, keepId), loadGame(db, dropId)]);
  if (!keep) throw new Error(`The game that stays (${keepId}) does not exist.`);
  if (!drop) throw new Error(`The game to drop (${dropId}) does not exist.`);
  if (keep.steamAppId !== null && drop.steamAppId !== null) {
    throw new MergeRefused(`os dois jogos têm steamAppId (${keep.steamAppId} e ${drop.steamAppId})`);
  }
  if (keep.guide && drop.guide) throw new MergeRefused("os dois jogos têm guia");

  const moved: Record<string, number> = {};
  for (const ref of GAME_REFS) moved[ref.key] = (moved[ref.key] ?? 0) + (await countRefs(db, ref, dropId));
  const ledger = await dropLedger(db, dropId);
  moved.ledger = ledger.length;
  const valid = ledger.filter((e) => e.voidedAt === null && e.source === "platinum");
  const takenKeys = valid.length
    ? await db.xpLedgerEntry.findMany({
        where: { OR: valid.map((e) => ({ userId: e.userId, source: e.source, sourceKey: keepKey(e, keepId) })) },
        select: { userId: true, sourceKey: true },
      })
    : [];
  const collisions = valid.filter((e) => takenKeys.some((t) => t.userId === e.userId && t.sourceKey === keepKey(e, keepId)));
  moved.platinumCollisions = collisions.length;
  // Steam's key is the bare gameId; the legacy PSN/Xbox/RA key (before trophy lists) is `<platform>:<gameId>`.
  const likelyRefused = collisions.some((e) => e.platform === null || e.sourceKey.split(":").length === 2);
  const users = await db.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserGame" WHERE "gameId" = ${dropId}
    UNION SELECT ua."userId" FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId" WHERE a."gameId" = ${dropId}
    UNION SELECT u."userId" FROM "UserTrophyList" u JOIN "TrophyList" l ON l.id = u."listId" WHERE l."gameId" = ${dropId}`;
  const usersRecomputed = [...new Set([...users.map((u) => u.userId), ...ledger.map((e) => e.userId)])].sort();
  const redirects = await db.gameSlugRedirect.findMany({ where: { gameId: dropId }, select: { fromSlug: true }, orderBy: { fromSlug: "asc" } });
  const report: MergeReport = {
    moved,
    usersRecomputed,
    redirects: [drop.slug, ...redirects.map((r) => r.fromSlug)],
    keepSlug: keep.slug,
    likelyRefused,
  };
  return { keep, drop, report, ledger };
}

const loadGame = (db: Db, id: string): Promise<Game | null> =>
  db.game.findUnique({ where: { id }, include: { guide: { select: { id: true } } } });

async function countRefs(db: Db, ref: (typeof GAME_REFS)[number], gameId: string): Promise<number> {
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${ref.model}" WHERE "${ref.column}" = $1`, gameId);
  return row.n;
}

/** Every GAME_REFS table must exist: a missing one aborts the join instead of moving nothing. */
async function assertGameRefTables(db: Db): Promise<void> {
  const models = [...new Set(GAME_REFS.map((r) => r.model))];
  const found = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ANY(${models}::text[])`;
  const present = new Set(found.map((t) => t.table_name));
  const missing = models.filter((m) => !present.has(m));
  if (missing.length > 0) {
    throw new Error(`Missing table(s) ${missing.join(", ")}: the join stops (a missing table is never "nothing to move").`);
  }
}

/** Nothing may still point at the drop when it is deleted (its cascades would take it along). */
async function assertNothingLeft(tx: Prisma.TransactionClient, dropId: string): Promise<void> {
  const left: string[] = [];
  for (const ref of GAME_REFS) {
    const n = await countRefs(tx, ref, dropId);
    if (n > 0) left.push(`${ref.model}.${ref.column} (${n})`);
  }
  if (left.length > 0) throw new Error(`Rows still point at the dropped game: ${left.join(", ")}.`);
}

/** The drop's `platinum` / `playtime` entries (valid or voided): the ledger keys that name the drop. */
async function dropLedger(db: Db, dropId: string): Promise<LedgerRow[]> {
  const rows = await db.xpLedgerEntry.findMany({
    where: {
      OR: [
        { source: "platinum", OR: [{ sourceKey: dropId }, { sourceKey: { endsWith: `:${dropId}` } }] },
        { source: "playtime", sourceKey: { contains: `:${dropId}:` } },
      ],
    },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.filter((e) => (e.source === "platinum" ? platinumGameId(e.sourceKey) : playtimeGameId(e.sourceKey)) === dropId);
}

async function moveRows(tx: Prisma.TransactionClient, keep: Game, drop: Game, users: string[]): Promise<void> {
  const keepId = keep.id;
  const dropId = drop.id;
  const move = { where: { gameId: dropId }, data: { gameId: keepId } };

  // No key of these names the game.
  await tx.gamePlatformLink.updateMany(move);
  await tx.trophyList.updateMany(move);
  await tx.achievement.updateMany(move);
  await tx.guide.updateMany(move);
  await tx.guideRequest.updateMany(move);
  await tx.article.updateMany(move);
  await tx.externalNews.updateMany(move);
  await tx.forumThread.updateMany(move);
  await tx.photo.updateMany(move);

  // A url (or a video) the keep already has is not copied.
  await tx.$executeRaw`
    DELETE FROM "GameMedia" d USING "GameMedia" k
    WHERE d."gameId" = ${dropId} AND k."gameId" = ${keepId}
      AND COALESCE(d.url, 'yt:' || d."youtubeId", 'none:' || d.kind) = COALESCE(k.url, 'yt:' || k."youtubeId", 'none:' || k.kind)`;
  await tx.gameMedia.updateMany(move);
  await tx.$executeRaw`
    INSERT INTO "GameSkill" ("gameId", skill) SELECT ${keepId}, skill FROM "GameSkill" WHERE "gameId" = ${dropId}
    ON CONFLICT DO NOTHING`;
  await tx.gameSkill.deleteMany({ where: { gameId: dropId } });

  // One row per key: the keep's stays.
  await tx.$executeRaw`
    DELETE FROM "WishlistItem" d USING "WishlistItem" k
    WHERE d."gameId" = ${dropId} AND k."gameId" = ${keepId} AND k."userId" = d."userId" AND k.platform = d.platform`;
  await tx.wishlistItem.updateMany(move);
  // The first time the player opened either page.
  await tx.$executeRaw`
    UPDATE "GameOpen" k SET "openedAt" = LEAST(k."openedAt", d."openedAt") FROM "GameOpen" d
    WHERE k."gameId" = ${keepId} AND d."gameId" = ${dropId} AND d."userId" = k."userId"`;
  await tx.$executeRaw`
    DELETE FROM "GameOpen" d USING "GameOpen" k WHERE d."gameId" = ${dropId} AND k."gameId" = ${keepId} AND k."userId" = d."userId"`;
  await tx.gameOpen.updateMany(move);
  await tx.$executeRaw`
    DELETE FROM "ArticleGame" d USING "ArticleGame" k WHERE d."gameId" = ${dropId} AND k."gameId" = ${keepId} AND k."articleId" = d."articleId"`;
  await tx.articleGame.updateMany(move);
  await tx.$executeRaw`
    DELETE FROM "GameRelease" d USING "GameRelease" k WHERE d."gameId" = ${dropId} AND k."gameId" = ${keepId} AND k.platform = d.platform`;
  await tx.gameRelease.updateMany(move);
  if (await tx.steamPlayerCount.findUnique({ where: { gameId: keepId }, select: { gameId: true } })) {
    await tx.steamPlayerCount.deleteMany({ where: { gameId: dropId } });
  } else {
    await tx.steamPlayerCount.updateMany(move);
  }

  await mergeUserGames(tx, keepId, dropId);
  await recountUnlocks(tx, keepId, users);

  const pairs = await tx.gameEdition.findMany({ where: { OR: [{ gameId: dropId }, { otherId: dropId }] } });
  await tx.gameEdition.deleteMany({ where: { OR: [{ gameId: dropId }, { otherId: dropId }] } });
  const others = [...new Set(pairs.map((p) => (p.gameId === dropId ? p.otherId : p.gameId)))].filter((id) => id !== keepId);
  if (others.length > 0) await tx.gameEdition.createMany({ data: others.map((id) => editionPair(keepId, id)), skipDuplicates: true });

  await moveIgdbAliases(tx, keep, drop);

  // Redirects to the drop are repointed before the drop goes (they cascade with it): A→B then B→C leads A to C.
  await tx.gameSlugRedirect.updateMany(move);
  await tx.gameSlugRedirect.upsert({
    where: { fromSlug: drop.slug },
    create: { fromSlug: drop.slug, gameId: keepId },
    update: { gameId: keepId },
  });
  // A mission condition may name a game (MissionCondition.gameId).
  await tx.$executeRaw`
    UPDATE "Mission" SET condition = jsonb_set(condition, '{gameId}', to_jsonb(${keepId}::text))
    WHERE condition->>'gameId' = ${dropId}`;
}

const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
const highest = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.max(a, b) : (a ?? b));

/** UserGame per (user, platform): the drop's row moves, or folds into the keep's (see mergeGames). */
async function mergeUserGames(tx: Prisma.TransactionClient, keepId: string, dropId: string): Promise<void> {
  const dropRows = await tx.userGame.findMany({ where: { gameId: dropId } });
  if (dropRows.length === 0) return;
  const keepRows = await tx.userGame.findMany({ where: { gameId: keepId, userId: { in: dropRows.map((r) => r.userId) } } });
  for (const d of dropRows) {
    const k = keepRows.find((r) => r.userId === d.userId && r.platform === d.platform);
    const where = { userId_gameId_platform: { userId: d.userId, gameId: keepId, platform: d.platform } };
    if (!k) {
      await tx.userGame.updateMany({ where: { userId: d.userId, gameId: dropId, platform: d.platform }, data: { gameId: keepId } });
    } else {
      await tx.userGame.update({
        where,
        data: {
          playtimeMin: k.playtimeMin + d.playtimeMin,
          completedAt: earliest(k.completedAt, d.completedAt),
          lastPlayedAt: latest(k.lastPlayedAt, d.lastPlayedAt),
          playtime2WeeksMin: highest(k.playtime2WeeksMin, d.playtime2WeeksMin),
          playtimeUpdatedAt: latest(k.playtimeUpdatedAt, d.playtimeUpdatedAt),
        },
      });
      await tx.userGame.delete({ where: { userId_gameId_platform: { userId: d.userId, gameId: dropId, platform: d.platform } } });
    }
  }
}

/**
 * UserGame.unlockedCount of the keep's rows of these users (every user with a drop row, unlock,
 * list progress or ledger entry), as the syncs count: every unlock of the game on that platform.
 */
async function recountUnlocks(tx: Prisma.TransactionClient, keepId: string, users: string[]): Promise<void> {
  const rows = await tx.userGame.findMany({ where: { gameId: keepId, userId: { in: users } }, select: { userId: true, platform: true } });
  for (const { userId, platform } of rows) {
    const unlockedCount = await tx.userAchievement.count({ where: { userId, achievement: { gameId: keepId, platform } } });
    await tx.userGame.update({ where: { userId_gameId_platform: { userId, gameId: keepId, platform } }, data: { unlockedCount } });
  }
}

/** The key an entry of the drop takes on the keep: the same key with the keep's id. */
function keepKey(e: LedgerRow, keepId: string): string {
  if (e.source === "platinum") {
    const colon = e.sourceKey.lastIndexOf(":");
    return colon < 0 ? keepId : `${e.sourceKey.slice(0, colon + 1)}${keepId}`;
  }
  const [platform, , hours] = e.sourceKey.split(":");
  return playtimeSourceKey(platform, keepId, Number(hours));
}

const copyAt = (e: LedgerRow, sourceKey: string): Prisma.XpLedgerEntryCreateManyInput => ({
  userId: e.userId,
  source: e.source,
  sourceKey,
  xp: e.xp,
  skills: e.skills,
  skillPoints: e.skillPoints === null ? Prisma.DbNull : e.skillPoints,
  platform: e.platform,
  dateUnknown: e.dateUnknown,
  createdAt: e.createdAt,
  voidedAt: e.voidedAt,
});

const milestoneHours = (sourceKey: string) => Number(sourceKey.split(":")[2]);

/**
 * Re-keys the drop's `platinum` / `playtime` entries onto the keep (rows already moved), then
 * settles every affected user on PSN/Xbox/RA. Entries are never edited (only `voidedAt`): an entry
 * moves by being voided now and copied (same xp, createdAt, platform, dateUnknown, skills).
 * - A voided entry is copied voided (same voidedAt) when the keep's key is free, so a key an
 *   unlink voided is never paid again after a relink.
 * - A valid entry goes to the keep's same key when no row has it (valid or voided).
 * - On a collision (the keep has that key): a platinum goes to a list platinum the merged game
 *   wants and nobody holds (two lists of one console from the two games: each list keeps one
 *   platinum, with the XP and date it was paid), else the join is refused; an hours milestone goes
 *   to a milestone the summed hours reached that the ledger lacks, else it stays valid under the
 *   drop's key (the XP was paid for real hours, and no key of the keep pays it again). Returns how
 *   many stayed.
 * Achievement entries need nothing: their key is the Achievement id, which moved with the row.
 */
async function rekeyLedger(
  tx: Prisma.TransactionClient,
  keepId: string,
  entries: LedgerRow[],
  users: string[],
  now: Date,
): Promise<number> {
  const id = (userId: string, source: string, sourceKey: string) => `${userId}\n${source}\n${sourceKey}`;
  const taken = new Set(
    entries.length === 0
      ? []
      : (
          await tx.xpLedgerEntry.findMany({
            where: { OR: entries.map((e) => ({ userId: e.userId, source: e.source, sourceKey: keepKey(e, keepId) })) },
            select: { userId: true, source: true, sourceKey: true },
          })
        ).map((e) => id(e.userId, e.source, e.sourceKey)),
  );
  const copies: Prisma.XpLedgerEntryCreateManyInput[] = [];
  const voided: string[] = [];
  const relocate = (e: LedgerRow, sourceKey: string) => {
    copies.push(copyAt(e, sourceKey));
    if (e.voidedAt === null) voided.push(e.id);
  };
  const flush = async () => {
    if (voided.length > 0) await tx.xpLedgerEntry.updateMany({ where: { id: { in: voided }, voidedAt: null }, data: { voidedAt: now } });
    if (copies.length > 0) await tx.xpLedgerEntry.createMany({ data: copies });
    voided.length = 0;
    copies.length = 0;
  };
  const collided: LedgerRow[] = [];
  for (const e of entries) {
    if (!taken.has(id(e.userId, e.source, keepKey(e, keepId)))) relocate(e, keepKey(e, keepId));
    else if (e.voidedAt === null) collided.push(e);
  }
  await flush();

  const platinums = collided.filter((e) => e.source === "platinum");
  const steam = platinums.find((e) => !isListPlatform(e.platform ?? "steam"));
  if (steam) throw new MergeRefused(`a platina ${steam.sourceKey} do usuário ${steam.userId} já existe no jogo que fica`);
  for (const userId of users) {
    for (const platform of LIST_PLATFORMS) {
      const mine = platinums.filter((e) => e.userId === userId && e.platform === platform);
      if (mine.length > 0) {
        const plan = await planListXp(tx, userId, platform, [keepId], { now });
        const free = plan.toCreate.filter((d) => d.source === "platinum");
        for (const e of mine) {
          // The free key of the same completion date (the same list) first.
          const same = free.findIndex((d) => new Date(d.createdAt!).getTime() === e.createdAt.getTime());
          const [slot] = free.splice(Math.max(0, same), 1);
          if (!slot) throw new MergeRefused(`a platina ${e.sourceKey} do usuário ${userId} não tem lugar no jogo que fica`);
          relocate(e, slot.sourceKey);
        }
        await flush();
      }
      await settleListXp(tx, userId, platform, [keepId], now);
    }
  }

  let kept = 0;
  const groups = new Map<string, LedgerRow[]>();
  for (const e of collided.filter((c) => c.source === "playtime")) {
    const group = `${e.userId}\n${e.sourceKey.split(":")[0]}`;
    groups.set(group, [...(groups.get(group) ?? []), e]);
  }
  for (const group of groups.values()) {
    const { userId } = group[0];
    const platform = group[0].sourceKey.split(":")[0];
    const row = await tx.userGame.findUnique({
      where: { userId_gameId_platform: { userId, gameId: keepId, platform } },
      select: { playtimeMin: true },
    });
    const reached = reachedMilestones(row?.playtimeMin ?? 0).map((m) => playtimeSourceKey(platform, keepId, m.hours));
    const present = await tx.xpLedgerEntry.findMany({
      where: { userId, source: "playtime", sourceKey: { in: reached } },
      select: { sourceKey: true },
    });
    const free = reached.filter((k) => !present.some((p) => p.sourceKey === k));
    for (const e of [...group].sort((a, b) => milestoneHours(a.sourceKey) - milestoneHours(b.sourceKey))) {
      const slot = free.shift();
      if (slot) relocate(e, slot);
      else kept++;
    }
  }
  await flush();
  return kept;
}

const GAME_TEXT_FIELDS = [
  "igdbId", "rawgId", "sgdbId", "developer", "publisher", "summary", "releaseDate", "criticScore",
  "coverUrl", "heroUrl", "logoUrl", "timeToBeatCompleteMin", "timeToBeatHastyMin", "timeToBeatNormalMin",
  "timeToBeatCheckedAt", "mediaCheckedAt",
] as const;
const STEAM_FIELDS = ["achievementCount", "steamReviewPositive", "steamReviewTotal", "steamReviewsAt", "detailsSyncedAt"] as const;

/** The keep takes the ids, texts and art it lacks; the drop's name and aliases become aliases. */
async function inheritGame(tx: Prisma.TransactionClient, keep: Game, drop: Game): Promise<void> {
  const data: Prisma.GameUncheckedUpdateInput = {};
  for (const field of GAME_TEXT_FIELDS) {
    if (keep[field] === null && drop[field] !== null) Object.assign(data, { [field]: drop[field] });
  }
  if (keep.steamAppId === null && drop.steamAppId !== null) {
    // Game.steamAppId is unique: the drop lets go of it first. Its Steam data comes along.
    await tx.game.update({ where: { id: drop.id }, data: { steamAppId: null } });
    data.steamAppId = drop.steamAppId;
    for (const field of STEAM_FIELDS) Object.assign(data, { [field]: drop[field] });
  }
  const seen = new Set([keep.name.trim().toLowerCase()]);
  const aliases: string[] = [];
  for (const alias of [...keep.aliases, drop.name, ...drop.aliases]) {
    const name = alias.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    aliases.push(name);
  }
  data.aliases = aliases;
  data.platforms = [...new Set([...keep.platforms, ...drop.platforms])];
  data.consoles = [...new Set([...keep.consoles, ...drop.consoles])];
  data.popularity = Math.max(keep.popularity, drop.popularity);
  data.stub = keep.stub && drop.stub;
  await tx.game.update({ where: { id: keep.id }, data });
  // A join keeps one igdbId: the drop's, when the keep has another, stays as an alias.
  await aliasDroppedIgdbId(tx, { id: keep.id, igdbId: keep.igdbId ?? drop.igdbId }, drop.igdbId);
}

/**
 * The approved pairs in an order that resolves chains: a game is dropped only after every join
 * into it ran (A→B, then B→C: A's slug ends on C). Refuses a game joined to itself, a game dropped
 * in two joins and a cycle.
 */
export function mergeOrder<T extends { keep: string; drop: string }>(pairs: T[]): T[] {
  const keepOf = new Map<string, string>();
  for (const p of pairs) {
    if (p.keep === p.drop) throw new Error(`${p.drop} is joined to itself.`);
    if (keepOf.has(p.drop)) throw new Error(`${p.drop} is dropped in two joins.`);
    keepOf.set(p.drop, p.keep);
  }
  /** Joins between a game and the game that finally keeps it. */
  const depth = (id: string) => {
    const seen = new Set<string>();
    let n = 0;
    for (let at = id; keepOf.has(at); at = keepOf.get(at)!) {
      if (seen.has(at)) throw new Error(`The joins of ${id} make a cycle.`);
      seen.add(at);
      n++;
    }
    return n;
  };
  return pairs
    .map((pair, index) => ({ pair, index, depth: depth(pair.keep) }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((x) => x.pair);
}
