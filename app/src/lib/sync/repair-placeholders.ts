import { prisma } from "@/lib/db";
import { readJson, type PoliteFetch } from "@/lib/integrations/steam/polite-fetch";
import { cleanName } from "@/lib/integrations/steam/store";
import type { SteamApi } from "@/lib/integrations";
import { isPlaceholderName, placeholderGames, renamePlaceholderGame } from "./steam-games";

/**
 * One-off repair (scripts/repair-placeholder-games.ts): Steam games still named with a placeholder
 * (`Steam App <n>` from the old syncGame, or `Jogo <appid> da Steam`) get their real name and slug
 * and go to the front of the details queue (cover and art follow from the steam-catalog job).
 * Names come first from the owners' libraries (GetOwnedGames with include_appinfo: one request per
 * owner covers all of their games), then from the store (appdetails `filters=basic`, throttled).
 * A game whose name cannot be found is made a stub (unlisted) until a later sync or job names it.
 * Idempotent: renamed games are no longer placeholders, so a second run finds nothing to rename.
 */

export type RepairDeps = {
  steam: SteamApi;
  /** Throttled fetch for the store; null skips the store (only library names are used). */
  politeFetch: PoliteFetch | null;
  log: (message: string) => void;
  now: () => Date;
};

export type RepairChange = {
  appId: number;
  from: string;
  /** New name, or null when none was found (the game became a stub). */
  to: string | null;
  slug: string | null;
  source: "library" | "store" | null;
};

export type RepairResult = {
  found: number;
  renamed: number;
  fromLibrary: number;
  fromStore: number;
  stubbed: number;
  failed: number;
  changes: RepairChange[];
};

/** Store name of an app (`filters=basic`), cleaned of trademark signs; null when the store does not know it. */
export async function fetchStoreName(politeFetch: PoliteFetch, appId: number): Promise<string | null> {
  const res = await politeFetch(
    `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=brazilian&cc=br`,
  );
  if (!res.ok) throw new Error(`Steam store appdetails ${appId} failed with HTTP ${res.status}`);
  const body = await readJson<Record<string, { success?: boolean; data?: { name?: string } }> | null>(res);
  const entry = body?.[String(appId)];
  const name = entry?.success ? cleanName(entry.data?.name ?? "") : "";
  return name || null;
}

/** Names from the libraries of the players who own the placeholder games (keyed Steam only). */
async function libraryNames(appIds: number[], deps: RepairDeps): Promise<Map<number, string>> {
  const owners = await prisma.user.findMany({
    where: {
      steamId: { not: null },
      games: { some: { platform: "steam", game: { steamAppId: { in: appIds } } } },
    },
    select: { id: true, steamId: true },
  });
  const names = new Map<number, string>();
  for (const owner of owners) {
    try {
      const library = await deps.steam.getOwnedGames(owner.steamId!);
      if (!Array.isArray(library)) {
        deps.log(`owner ${owner.id}: library ${library}, skipped`);
        continue;
      }
      for (const g of library) {
        const name = cleanName(g.name ?? "");
        if (name && !names.has(g.appId)) names.set(g.appId, name);
      }
    } catch (error) {
      deps.log(`owner ${owner.id}: library read failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return names;
}

export async function repairPlaceholderGames({
  dryRun,
  deps,
}: {
  dryRun: boolean;
  deps: RepairDeps;
}): Promise<RepairResult> {
  const games = await placeholderGames();
  const result: RepairResult = { found: games.length, renamed: 0, fromLibrary: 0, fromStore: 0, stubbed: 0, failed: 0, changes: [] };
  deps.log(`${games.length} placeholder games${dryRun ? " (dry run: nothing is written)" : ""}`);
  if (games.length === 0) return result;

  const fromLibrary = await libraryNames(games.map((g) => g.steamAppId), deps);
  for (const game of games) {
    let name: string | null = fromLibrary.get(game.steamAppId) ?? null;
    let source: RepairChange["source"] = name ? "library" : null;
    if ((!name || isPlaceholderName(name, game.steamAppId)) && deps.politeFetch) {
      try {
        name = await fetchStoreName(deps.politeFetch, game.steamAppId);
        source = name ? "store" : null;
      } catch (error) {
        result.failed++;
        deps.log(`${game.steamAppId} "${game.name}": store failed (${error instanceof Error ? error.message : String(error)}), left as is`);
        continue;
      }
    }
    if (name && isPlaceholderName(name, game.steamAppId)) name = null;

    if (!name) {
      result.stubbed++;
      result.changes.push({ appId: game.steamAppId, from: game.name, to: null, slug: null, source: null });
      deps.log(`${game.steamAppId} "${game.name}": no name found → stub (unlisted)${dryRun ? " [dry run]" : ""}`);
      if (!dryRun && !game.stub) await prisma.game.update({ where: { id: game.id }, data: { stub: true } });
      continue;
    }
    if (dryRun) {
      result.renamed++;
      result[source === "store" ? "fromStore" : "fromLibrary"]++;
      result.changes.push({ appId: game.steamAppId, from: game.name, to: name, slug: null, source });
      deps.log(`${game.steamAppId} "${game.name}" → "${name}" (${source}) [dry run]`);
      continue;
    }
    const renamed = await renamePlaceholderGame(game.id, name, deps.now());
    if (!renamed) {
      deps.log(`${game.steamAppId} "${game.name}": renamed meanwhile, skipped`);
      continue;
    }
    result.renamed++;
    result[source === "store" ? "fromStore" : "fromLibrary"]++;
    result.changes.push({ appId: game.steamAppId, from: game.name, to: renamed.name, slug: renamed.slug, source });
    deps.log(`${game.steamAppId} "${game.name}" → "${renamed.name}" /jogos/${renamed.slug} (${source}), queued for details`);
  }
  return result;
}
