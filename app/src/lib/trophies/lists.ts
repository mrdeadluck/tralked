import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Trophy lists: one TrophyList per (platform, externalId). A "version" groups the lists a player
// counts once (a PSN console, an Xbox title, ...); see versionKey.

const PSN_ORDER = ["PS3", "PSVITA", "PS4", "PS5", "PSPC"] as const;
const PSN_LABELS: Record<string, string> = { PS3: "PS3", PSVITA: "Vita", PS4: "PS4", PS5: "PS5", PSPC: "PC" };

/** "PS3,PSVITA" -> "PS3+PSVITA" in a fixed order; nothing known -> null. */
export function psnConsoleCode(trophyTitlePlatform: string): string | null {
  const present = new Set(
    trophyTitlePlatform
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  const codes = PSN_ORDER.filter((c) => present.has(c));
  return codes.length ? codes.join("+") : null;
}

export function xboxConsoleOf(devices: string[]): "360" | "ONE" | "PC" | null {
  if (devices.includes("Xbox360")) return "360";
  if (devices.includes("XboxOne") || devices.includes("XboxSeries")) return "ONE";
  if (devices.includes("PC") || devices.includes("Win32")) return "PC";
  return null;
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;
const KANA_OR_CJK = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿]/u;

/** Never deduces China: a name with only ideographs is not unambiguous (it is read as "jp"). */
export function regionOf(name: string): "jp" | "kr" | null {
  if (HANGUL.test(name)) return "kr";
  if (KANA_OR_CJK.test(name)) return "jp";
  return null;
}

export function versionKey(list: { platform: string; console: string | null; externalId: string }): string {
  if (list.platform === "steam") return "steam";
  if (list.platform === "psn") return `psn:${list.console ?? list.externalId}`;
  return `${list.platform}:${list.externalId}`;
}

const XBOX_LABELS: Record<string, string> = { "360": "Xbox 360", ONE: "Xbox One/Series", PC: "Xbox PC" };

export function versionLabel(list: { platform: string; console: string | null }): string {
  switch (list.platform) {
    case "psn":
      if (!list.console) return "PlayStation";
      return list.console
        .split("+")
        .map((c) => PSN_LABELS[c] ?? c)
        .join(" · ");
    case "steam":
      return "PC · Steam";
    case "xbox":
      return (list.console && XBOX_LABELS[list.console]) || "Xbox";
    default:
      return list.console ?? "Retro";
  }
}

type Orderable = { createdAt: Date; externalId: string };
const byCreation = (a: Orderable, b: Orderable) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0);

const REGION_LABELS: Record<string, string> = { jp: "🇯🇵 Ásia", kr: "🇰🇷 Ásia" };

/** List id -> region label, "Lista N" (creation order among the region-less lists) or null. */
export function regionLabels(
  lists: { id: string; region: string | null; createdAt: Date; externalId: string }[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (lists.length <= 1) {
    for (const l of lists) out.set(l.id, null);
    return out;
  }
  let n = 0;
  for (const l of lists.filter((x) => !x.region).sort(byCreation)) out.set(l.id, `Lista ${++n}`);
  for (const l of lists) if (l.region) out.set(l.id, REGION_LABELS[l.region] ?? null);
  return out;
}

/** The oldest list (tie: externalId ascending). */
export function canonicalList<T extends Orderable>(lists: T[]): T {
  if (lists.length === 0) throw new Error("canonicalList: a version always has at least one list");
  return [...lists].sort(byCreation)[0];
}

/**
 * `${platform}:${apiName}` -> the Achievement row a guide note on that trophy goes to: on a game
 * with several lists, the row of the oldest list holding the apiName (canonicalList's order, as
 * the phase finish moves notes); list-less rows (written before trophy lists) only when no list
 * holds it.
 */
export function noteTargetIds(
  rows: { id: string; platform: string; apiName: string; list: Orderable | null }[],
): Map<string, string> {
  const ordered = [...rows].sort((a, b) =>
    a.list && b.list ? byCreation(a.list, b.list) : Number(!a.list) - Number(!b.list),
  );
  const out = new Map<string, string>();
  for (const r of ordered) {
    const key = `${r.platform}:${r.apiName}`;
    if (!out.has(key)) out.set(key, r.id);
  }
  return out;
}

type Db = Prisma.TransactionClient | PrismaClient;

export type EnsureTrophyListInput = {
  gameId: string;
  platform: string;
  externalId: string;
  console: string | null;
  name: string;
  serviceName?: string | null;
  conceptId?: number | null;
  trophyCount: number;
};

const SELECT = { id: true, gameId: true, console: true, createdAt: true } as const;

/**
 * Upsert by (platform, externalId). console / conceptId / serviceName are written only while null
 * (console is part of the XP keys); name, region and trophyCount are refreshed; gameId never moves.
 */
export async function ensureTrophyList(
  db: Db,
  input: EnsureTrophyListInput,
): Promise<{ id: string; gameId: string; console: string | null; createdAt: Date }> {
  const where = { platform_externalId: { platform: input.platform, externalId: input.externalId } };
  const region = regionOf(input.name);

  const update = async (current: { console: string | null; serviceName: string | null; conceptId: number | null }) =>
    db.trophyList.update({
      where,
      data: {
        name: input.name,
        region,
        trophyCount: input.trophyCount,
        ...(current.console === null && input.console ? { console: input.console } : {}),
        ...(current.serviceName === null && input.serviceName ? { serviceName: input.serviceName } : {}),
        ...(current.conceptId === null && input.conceptId != null ? { conceptId: input.conceptId } : {}),
      },
      select: SELECT,
    });

  // ON CONFLICT DO NOTHING never aborts a surrounding transaction (a P2002 would, with 25P02),
  // so this is safe inside interactive transactions and under concurrent creates.
  await db.trophyList.createMany({
    data: [
      {
        gameId: input.gameId,
        platform: input.platform,
        externalId: input.externalId,
        console: input.console,
        name: input.name,
        serviceName: input.serviceName ?? null,
        conceptId: input.conceptId ?? null,
        region,
        trophyCount: input.trophyCount,
      },
    ],
    skipDuplicates: true,
  });
  return update(await db.trophyList.findUniqueOrThrow({ where }));
}
