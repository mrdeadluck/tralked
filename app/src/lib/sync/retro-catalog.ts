import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { RetroCatalogApi, RetroCatalogEntry } from "@/lib/integrations/retro/catalog";
import { slugify } from "./catalog";
import { candidateFamilies, familyOfLabel } from "./igdb-games";
import { CATALOG_CREATE_LOCK } from "./steam-games";

/**
 * The RetroAchievements catalog (item 15), imported weekly by the retro-catalog worker
 * (scripts/retro-catalog-worker.ts):
 * 1. `importRetroCatalog`: every console's games with achievements (RA API_GetGameList `f=1`) into
 *    the light RetroCatalogGame table (id, title, console, icon, counts), rewriting only rows RA
 *    changed;
 * 2. `linkRetroCatalog`: each RA game not linked yet to a catalog Game (GamePlatformLink, platform
 *    `retro`, the same link the RA player sync uses) is linked by name to a game of a matching
 *    platform family, or becomes a name-only stub (`Game.stub`, out of listings, found by the
 *    search) with its own page. Hacks, homebrew, prototypes and other `~Tagged~` sets and
 *    `[Subset - …]` sets never become stubs: they stay in the light table until a player who owns
 *    one syncs (resolvePlatformGame creates the game then).
 * Achievement lists are not imported here: lib/sync/retro-achievements.ts reads them on demand.
 */

const CHUNK = 500;
/** An RA game left unlinked (ambiguous name, tagged set) is looked at again after this long. */
const RETRY_MS = 30 * 24 * 3_600_000;

export type RetroLog = { info(message: string): void; warn(message: string): void };
const quiet: RetroLog = { info: () => {}, warn: () => {} };

/** `~Hack~ …`, `~Homebrew~ …`, `~Prototype~ …`, `[Subset - Bonus]`: not a game of its own. */
export function isCoreSet(title: string): boolean {
  return !/^\s*~[^~]+~/.test(title) && !/\[\s*subset\b/i.test(title);
}

/**
 * The names an RA title may go by in the catalog. RA moves a leading article to the end
 * (`Legend of Zelda, The: A Link to the Past`) and lists alternative names with ` | `; trademark
 * signs and doubled spaces go. The first name is the one shown when the game is created.
 */
export function retroTitleNames(title: string): string[] {
  const out: string[] = [];
  for (const part of title.split(/\s+\|\s+/)) {
    const clean = part.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    // Only an article that ends the name or comes right before a subtitle (`, The: …`, `, The - …`).
    const inverted = /^(.+?), (The|A|An)((?:\s*[:\-–(].*)?)$/i.exec(clean);
    const name = inverted ? `${inverted[2]} ${inverted[1]}${inverted[3]}` : clean;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export type ImportResult = { consoles: number; games: number; written: number; failedConsoles: number };

/** Reads every console's list and writes the rows RA added or changed. */
export async function importRetroCatalog(api: RetroCatalogApi, log: RetroLog = quiet): Promise<ImportResult> {
  const consoles = await api.getConsoles();
  const result: ImportResult = { consoles: consoles.length, games: 0, written: 0, failedConsoles: 0 };
  for (const system of consoles) {
    let games: RetroCatalogEntry[];
    try {
      games = await api.getGameList(system.id);
    } catch (error) {
      result.failedConsoles++;
      log.warn(`RA console ${system.id} (${system.name}): ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    result.games += games.length;
    for (let i = 0; i < games.length; i += CHUNK) {
      result.written += await upsertEntries(games.slice(i, i + CHUNK).map((g) => ({ ...g, consoleName: g.consoleName || system.name })));
    }
  }
  return result;
}

async function upsertEntries(games: RetroCatalogEntry[]): Promise<number> {
  if (games.length === 0) return 0;
  return prisma.$executeRaw`
    INSERT INTO "RetroCatalogGame" AS r
      (id, title, "consoleId", "consoleName", "iconPath", "achievementCount", points, "setModifiedAt")
    SELECT g.id, g.title, g.cid, g.cname, g.icon, g.n, g.pts, g.mod::timestamp
    FROM unnest(
      ${games.map((g) => g.id)}::int[], ${games.map((g) => g.title)}::text[],
      ${games.map((g) => g.consoleId)}::int[], ${games.map((g) => g.consoleName)}::text[],
      ${games.map((g) => g.iconPath)}::text[], ${games.map((g) => g.achievementCount)}::int[],
      ${games.map((g) => g.points)}::int[], ${games.map((g) => g.modifiedAt?.toISOString() ?? null)}::text[]
    ) AS g(id, title, cid, cname, icon, n, pts, mod)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, "consoleId" = EXCLUDED."consoleId", "consoleName" = EXCLUDED."consoleName",
      "iconPath" = EXCLUDED."iconPath", "achievementCount" = EXCLUDED."achievementCount",
      points = EXCLUDED.points, "setModifiedAt" = EXCLUDED."setModifiedAt"
    WHERE (r.title, r."consoleId", r."consoleName", r."iconPath", r."achievementCount", r.points, r."setModifiedAt")
      IS DISTINCT FROM (EXCLUDED.title, EXCLUDED."consoleId", EXCLUDED."consoleName", EXCLUDED."iconPath",
                        EXCLUDED."achievementCount", EXCLUDED.points, EXCLUDED."setModifiedAt")`;
}

type QueueRow = { id: number; title: string; consoleName: string };
export type Candidate = { input: string; id: string; platforms: string[]; links: string[] };

/** Catalog games named like each input: same lower(name) (expression index) or same folded searchName (trigram index). */
export async function candidatesByName(tx: Prisma.TransactionClient, names: string[]): Promise<Map<string, Candidate[]>> {
  const out = new Map<string, Candidate[]>();
  if (names.length === 0) return out;
  const rows = await tx.$queryRaw<Candidate[]>`
    WITH q AS (SELECT DISTINCT n AS input FROM unnest(${names}::text[]) AS n),
    hits AS (
      SELECT q.input, g.id FROM q JOIN "Game" g ON lower(g.name) = lower(q.input)
      UNION
      SELECT q.input, g.id FROM q JOIN "Game" g ON g."searchName" = tralked_search_name(q.input)
    )
    SELECT h.input, g.id, g.platforms,
           COALESCE((SELECT array_agg(DISTINCT l.platform) FROM "GamePlatformLink" l WHERE l."gameId" = g.id), '{}') AS links
    FROM hits h JOIN "Game" g ON g.id = h.id`;
  for (const row of rows) out.set(row.input, [...(out.get(row.input) ?? []), row]);
  return out;
}

/**
 * The catalog game an RA game is, among the games named like it: never one that already holds
 * another RA set (one page per RA game, so progress totals stay per set); with a family known for
 * the RA console (Nintendo, PlayStation, Xbox), a game on that family or on no known family;
 * otherwise (Mega Drive, arcade, Atari…) only a game on no known family (the Steam `Sonic the
 * Hedgehog` is not the Mega Drive one). "ambiguous" when several fit.
 */
export function pickRetroMatch(candidates: Candidate[], consoleName: string): string | "ambiguous" | null {
  const family = familyOfLabel(consoleName);
  const ids = new Set<string>();
  for (const c of candidates) {
    if (c.links.includes("retro")) continue;
    const families = candidateFamilies(c);
    if (families.size === 0 || (family !== null && families.has(family))) ids.add(c.id);
  }
  if (ids.size > 1) return "ambiguous";
  return ids.size === 1 ? [...ids][0] : null;
}

export type LinkResult = { linked: number; created: number; ambiguous: number; skipped: number };

/**
 * Links (or creates) the catalog game of every RA game waiting for it, a chunk at a time, under
 * the catalog creation lock the Steam and IGDB imports take, until the queue is empty or
 * `stopAt` (ms). `create: false` only links.
 */
export async function linkRetroCatalog(
  { stopAt = Infinity, create = true, now = () => new Date() }: { stopAt?: number; create?: boolean; now?: () => Date } = {},
): Promise<LinkResult> {
  const result: LinkResult = { linked: 0, created: 0, ambiguous: 0, skipped: 0 };
  while (Date.now() < stopAt) {
    const at = now();
    const queue = await prisma.$queryRaw<QueueRow[]>`
      SELECT r.id, r.title, r."consoleName" FROM "RetroCatalogGame" r
      WHERE (r."matchedAt" IS NULL OR r."matchedAt" < ${new Date(at.getTime() - RETRY_MS)})
        AND NOT EXISTS (SELECT 1 FROM "GamePlatformLink" l WHERE l.platform = 'retro' AND l."externalId" = r.id::text)
      ORDER BY r.id LIMIT ${CHUNK}`;
    if (queue.length === 0) break;
    const part = await linkChunk(queue, create, at);
    result.linked += part.linked;
    result.created += part.created;
    result.ambiguous += part.ambiguous;
    result.skipped += part.skipped;
  }
  return result;
}

async function linkChunk(queue: QueueRow[], create: boolean, at: Date): Promise<LinkResult> {
  const result: LinkResult = { linked: 0, created: 0, ambiguous: 0, skipped: 0 };
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATALOG_CREATE_LOCK}::bigint)`;
      const core = queue.filter((r) => isCoreSet(r.title));
      result.skipped += queue.length - core.length;
      const names = new Map(core.map((r) => [r.id, retroTitleNames(r.title)]));
      const byName = await candidatesByName(tx, [...new Set([...names.values()].flat())]);

      const links: { gameId: string; platform: string; externalId: string }[] = [];
      const fresh: QueueRow[] = [];
      for (const row of core) {
        const candidates = names.get(row.id)!.flatMap((n) => byName.get(n) ?? []);
        const pick = pickRetroMatch(candidates, row.consoleName);
        if (pick === "ambiguous") result.ambiguous++;
        else if (pick) links.push({ gameId: pick, platform: "retro", externalId: String(row.id) });
        else if (create) fresh.push(row);
        else result.skipped++;
      }
      // Two RA games of one name in the same chunk must not both take one game.
      const taken = new Set<string>();
      const unique = links.filter((l) => {
        if (taken.has(l.gameId)) {
          result.ambiguous++;
          return false;
        }
        taken.add(l.gameId);
        return true;
      });
      result.linked += (await tx.gamePlatformLink.createMany({ data: unique, skipDuplicates: true })).count;

      if (fresh.length > 0) {
        const bases = fresh.map((row) => {
          const name = names.get(row.id)![0] ?? row.title;
          return { row, name, base: slugify(name.replace(/['’]/g, "")) || `ra-${row.id}` };
        });
        const used = new Set(
          (await tx.game.findMany({ where: { slug: { in: bases.map((b) => b.base) } }, select: { slug: true } })).map((g) => g.slug),
        );
        const data = bases.map(({ row, name, base }) => {
          const slug = used.has(base) ? `${base}-ra-${row.id}` : base;
          used.add(slug);
          const family = familyOfLabel(row.consoleName);
          return { slug, name, platforms: [family ?? (row.consoleName || "Retro")], achievementCount: 0, stub: true };
        });
        // `<slug>-ra-<id>` can only clash with a game created under that very slug: skipped, retried next run.
        const games = await tx.game.createManyAndReturn({ data, skipDuplicates: true, select: { id: true, slug: true } });
        const idOf = new Map(games.map((g) => [g.slug, g.id]));
        const created = data.flatMap((d, i) => {
          const gameId = idOf.get(d.slug);
          return gameId ? [{ gameId, platform: "retro", externalId: String(bases[i].row.id) }] : [];
        });
        await tx.gamePlatformLink.createMany({ data: created, skipDuplicates: true });
        result.created += created.length;
      }

      await tx.retroCatalogGame.updateMany({ where: { id: { in: queue.map((r) => r.id) } }, data: { matchedAt: at } });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  return result;
}
