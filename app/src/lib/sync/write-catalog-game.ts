import type { Game } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { SkillId } from "@/lib/engine/types";
import { isSteamCdnUrl } from "@/lib/integrations/steam/polite-fetch";
import type { StoreApp } from "@/lib/integrations/steam/store";
import type { SteamSchemaAchievement } from "@/lib/integrations/steam/types";
import { slugify } from "@/lib/sync/catalog";
import { isPlaceholderName, slugAfterPlaceholder } from "@/lib/sync/steam-games";

export type CatalogMedia = {
  kind: "cover" | "capsule" | "hero" | "logo" | "artwork" | "screenshot" | "video";
  url: string;
  width?: number;
  height?: number;
  order: number;
  /** Videos: the store's title of the trailer. */
  title?: string;
};

export type CatalogGameInput = {
  appId: number;
  store: StoreApp;
  schema: SteamSchemaAchievement[];
  percentages: Record<string, number>;
  skills: SkillId[];
  media: CatalogMedia[];
  /** Time of the write (`detailsSyncedAt`). */
  now?: Date;
};

const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 20_000 };
const MEDIA_SOURCE = "steam";

/** A game is complete once its Steam media is written (the last step of `writeCatalogGame`). */
export async function completedAppIds(): Promise<Set<number>> {
  const rows = await prisma.game.findMany({
    where: { steamAppId: { not: null }, media: { some: { source: MEDIA_SOURCE } } },
    select: { steamAppId: true },
  });
  return new Set(rows.flatMap((r) => (r.steamAppId === null ? [] : [r.steamAppId])));
}

/**
 * Creates or completes one catalog game from Steam data, in one transaction and without deleting
 * anything. Existing games keep the fields they already have (editorial text, slug, manual skills)
 * and only get the blanks filled; achievements are upserted by apiName; media rows from Steam are
 * upserted by (kind, order). Media and icons are hotlinked, so only https Steam CDN URLs are kept.
 */
export async function writeCatalogGame(input: CatalogGameInput): Promise<{ game: Game; created: boolean }> {
  const { appId, store, schema, percentages, skills } = input;
  const media = input.media.filter((m) => isSteamCdnUrl(m.url));
  const art = (kind: CatalogMedia["kind"]) => media.find((m) => m.kind === kind && m.order === 0)?.url;
  const fields = {
    name: store.name,
    summary: store.summary,
    developer: store.developer,
    publisher: store.publisher,
    releaseDate: store.releaseDate,
    criticScore: store.criticScore,
    coverUrl: art("cover"),
    heroUrl: art("hero"),
    logoUrl: art("logo"),
  };

  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const current = await tx.game.findUnique({ where: { steamAppId: appId }, include: { skills: true } });
    let game: Game;
    if (current) {
      const blanks = Object.fromEntries(
        Object.entries(fields).filter(([key, value]) => value !== undefined && current[key as keyof typeof fields] == null),
      );
      // A name-only stub of the full catalog (or a placeholder name) takes the store's name; an
      // editorial name is never overwritten.
      const renamed =
        current.stub || isPlaceholderName(current.name, appId)
          ? { name: store.name, ...(await slugAfterPlaceholder(tx, current, store.name, appId)) }
          : {};
      game = await tx.game.update({
        where: { id: current.id },
        data: {
          ...blanks,
          ...renamed,
          // An empty schema (no achievements, or a read that failed) keeps the count it had.
          ...(schema.length > 0 && { achievementCount: schema.length }),
          platforms: current.platforms.includes("PC") ? current.platforms : [...current.platforms, "PC"],
          stub: false,
          detailsSyncedAt: now,
          detailsRequestedAt: null,
        },
      });
    } else {
      // "Tom Clancy's" → "tom-clancys", like the seed's "baldurs-gate-3".
      const base = slugify(store.name.replace(/['’]/g, "")) || `app-${appId}`;
      const taken = await tx.game.findUnique({ where: { slug: base }, select: { id: true } });
      game = await tx.game.create({
        data: {
          ...fields,
          slug: taken ? `${base}-${appId}` : base,
          steamAppId: appId,
          platforms: ["PC"],
          achievementCount: schema.length,
          detailsSyncedAt: now,
        },
      });
    }

    await tx.gamePlatformLink.createMany({
      data: [{ gameId: game.id, platform: "steam", externalId: String(appId) }],
      skipDuplicates: true,
    });

    // Same rule as the catalog sync: skills are only set while the game has none (admin overrides stay).
    if ((current?.skills.length ?? 0) === 0 && skills.length > 0) {
      await tx.gameSkill.createMany({
        data: skills.map((skill) => ({ gameId: game.id, skill })),
        skipDuplicates: true,
      });
    }

    const rows = await tx.achievement.findMany({ where: { gameId: game.id, platform: "steam" } });
    const byApiName = new Map(rows.map((r) => [r.apiName, r]));
    const achievementFields = (a: SteamSchemaAchievement) => ({
      name: a.name,
      description: a.description ?? null,
      iconUrl: isSteamCdnUrl(a.iconUrl) ? a.iconUrl : null,
      ...(percentages[a.apiName] !== undefined && { globalPct: percentages[a.apiName] }),
    });

    // Rows written under another apiName (the seed's fixture ids) are matched by their display
    // name when it is unique on both sides, and take Steam's apiName: unlocks keep pointing at them.
    const schemaIds = new Set(schema.map((a) => a.apiName));
    const uniqueByName = <T>(items: T[], name: (item: T) => string) => {
      const groups = new Map<string, T[]>();
      for (const item of items) {
        const key = name(item).toLowerCase();
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      return new Map([...groups].filter(([, group]) => group.length === 1).map(([key, [item]]) => [key, item]));
    };
    const orphans = uniqueByName(rows.filter((r) => !schemaIds.has(r.apiName)), (r) => r.name);
    const schemaByName = uniqueByName(schema, (a) => a.name);
    for (const [key, a] of schemaByName) {
      const orphan = orphans.get(key);
      if (!orphan || byApiName.has(a.apiName)) continue;
      const renamed = await tx.achievement.update({ where: { id: orphan.id }, data: { apiName: a.apiName } });
      byApiName.delete(orphan.apiName);
      byApiName.set(a.apiName, renamed);
    }
    await tx.achievement.createMany({
      data: schema
        .filter((a) => !byApiName.has(a.apiName))
        .map((a) => ({ gameId: game.id, platform: "steam", apiName: a.apiName, hidden: a.hidden, ...achievementFields(a) })),
      skipDuplicates: true,
    });
    for (const a of schema) {
      const row = byApiName.get(a.apiName);
      if (!row) continue;
      const next = achievementFields(a);
      const changed = (Object.keys(next) as (keyof typeof next)[]).some((key) => next[key] !== row[key]);
      if (changed) await tx.achievement.update({ where: { id: row.id }, data: next });
    }

    const existingMedia = await tx.gameMedia.findMany({ where: { gameId: game.id, source: MEDIA_SOURCE } });
    for (const m of media) {
      const data = { url: m.url, width: m.width ?? null, height: m.height ?? null, title: m.title ?? null };
      const row = existingMedia.find((e) => e.kind === m.kind && e.order === m.order);
      if (row) await tx.gameMedia.update({ where: { id: row.id }, data });
      else await tx.gameMedia.create({ data: { ...data, gameId: game.id, kind: m.kind, order: m.order, source: MEDIA_SOURCE } });
    }

    return { game, created: !current };
  }, TRANSACTION_OPTIONS);
}
