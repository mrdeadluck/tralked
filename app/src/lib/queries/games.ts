import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  achievementKey,
  parseStoredBlocks,
  type AchievementCardData,
  type AchievementPlatform,
  type ContentBlock,
} from "@/lib/content/schema";
import { caseArt, steamHeaderUrl, type CaseArtSource } from "@/lib/case-art";
import { isSafeHttpUrl, safeImageUrl } from "@/lib/content/url";
import { prisma } from "@/lib/db";
import { rarityTier, xpForAchievement } from "@/lib/engine/xp";
import { SKILLS, type RarityTier, type SkillId } from "@/lib/engine/types";
import { foldQueryInDb } from "@/lib/search/normalize";
import { achievementTotal } from "@/lib/games/achievement-total";
import { parseReport, type GuideReport } from "@/lib/admin/guide-report";
import { quietSources } from "@/lib/content/source-talk";
import { GUIDE_COMPAT, walkthroughSchema, type GuideCompat, type Walkthrough } from "@/lib/content/walkthrough-schema";
import { loadTimeTo100, type TimeTo100 } from "./time-to-100";

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));

function asSkills(values: string[]): SkillId[] {
  return values.filter((v): v is SkillId => SKILL_IDS.has(v));
}

/** "Almost there": at least 70% unlocked, but not 100%. */
export function isAlmostComplete(unlocked: number, total: number): boolean {
  return total > 0 && unlocked * 100 >= total * 70 && unlocked < total;
}

// ---------- Catalog ----------

export type GameFilter = {
  skill?: SkillId;
  almost?: boolean;
  withGuide?: boolean;
  q?: string;
  /** PC | PLAYSTATION | XBOX | NINTENDO | RETRO */
  platform?: string;
  /** Only games on that platform family and no other (PC / PlayStation / Xbox / Nintendo). */
  exclusive?: boolean;
  /** Only games with a trophy / achievement list. */
  withTrophies?: boolean;
};

/** Platform filters of the catalog (the "Jogos" menu), Steam / PC first. */
export const CATALOG_PLATFORMS = ["PC", "PLAYSTATION", "XBOX", "NINTENDO", "RETRO"] as const;

/** Account platform whose game ids (GamePlatformLink) also put a game under a catalog platform. */
const LINK_PLATFORM: Record<string, string | undefined> = { PLAYSTATION: "psn", XBOX: "xbox", RETRO: "retro" };

/** IGDB console slugs (Game.consoles) that have a trophy / achievement system. */
const PLAYSTATION_TROPHY_CONSOLES = ["ps4", "ps5", "psvita"];
const XBOX_ACHIEVEMENT_CONSOLES = ["xbox360", "xboxone", "series-x-s"];
/** PS3 trophies started with firmware 2.40 in mid-2008: earlier PS3 games have none. */
const PS3_TROPHIES_FROM = new Date("2008-01-01T00:00:00Z");

/** The families the "exclusive" filter compares (Retro stays out of the count). */
const EXCLUSIVITY_FAMILIES = ["PC", "PLAYSTATION", "XBOX", "NINTENDO"] as const;

/**
 * The game is under a family: its catalog list says so, or it has an id on that network (games
 * created by a PSN/Xbox/RetroAchievements sync list their console). PC is "exists on Steam"
 * (`steamAppId`, label "PC · Steam"); Retro only exists through RetroAchievements ids.
 */
function onFamily(platform: string): Prisma.GameWhereInput {
  if (platform === "PC") return { steamAppId: { not: null } };
  const link = LINK_PLATFORM[platform];
  const byLink: Prisma.GameWhereInput | null = link ? { platformLinks: { some: { platform: link } } } : null;
  if (platform === "RETRO") return byLink!;
  return byLink ? { OR: [{ platforms: { has: platform } }, byLink] } : { platforms: { has: platform } };
}

/** Same as `onFamily`, for the exclusivity count: an IGDB PC release counts as being on PC too. */
function countsAsFamily(platform: string): Prisma.GameWhereInput {
  return platform === "PC" ? { OR: [{ platforms: { has: "PC" } }, { steamAppId: { not: null } }] } : onFamily(platform);
}

function exclusiveTo(platform: string): Prisma.GameWhereInput {
  const others = EXCLUSIVITY_FAMILIES.filter((f) => f !== platform).map((f) => ({ NOT: countsAsFamily(f) }));
  return { AND: [onFamily(platform), ...others] };
}

/** The game has a trophy / achievement list on that family (Nintendo has none). */
function withTrophiesOn(platform: string): Prisma.GameWhereInput {
  switch (platform) {
    case "PLAYSTATION":
      return {
        OR: [
          { consoles: { hasSome: PLAYSTATION_TROPHY_CONSOLES } },
          { AND: [{ consoles: { has: "ps3" } }, { releaseDate: { gte: PS3_TROPHIES_FROM } }] },
          { trophyLists: { some: { platform: "psn", trophyCount: { gt: 0 } } } },
        ],
      };
    case "XBOX":
      return { OR: [{ consoles: { hasSome: XBOX_ACHIEVEMENT_CONSOLES } }, { trophyLists: { some: { platform: "xbox" } } }] };
    case "PC":
      return { achievementCount: { gt: 0 } };
    case "RETRO":
      // Every RetroCatalogGame has achievements (the RA game list import drops empty sets), and
      // it only reaches a catalog game through this link.
      return { OR: [{ trophyLists: { some: { platform: "retro" } } }, { platformLinks: { some: { platform: "retro" } } }] };
    default:
      return { id: { in: [] } };
  }
}

/**
 * Where of the catalog filters. `platform` narrows to a family; `exclusive` keeps the games that
 * are on no other family (PS4 + PS5 is still PlayStation only; a later Steam release ends it);
 * `withTrophies` keeps the games with a trophy / achievement list. Without a platform the two
 * flags look across every family.
 */
export function catalogWhere(filter: Pick<GameFilter, "platform" | "exclusive" | "withTrophies">): Prisma.GameWhereInput {
  const { platform, exclusive, withTrophies } = filter;
  const families = platform ? [platform] : [...EXCLUSIVITY_FAMILIES, "RETRO"];
  const per = (f: string): Prisma.GameWhereInput => ({
    AND: [onFamily(f), ...(exclusive ? [exclusiveTo(f)] : []), ...(withTrophies ? [withTrophiesOn(f)] : [])],
  });
  if (!platform && !exclusive && !withTrophies) return {};
  return families.length === 1 ? per(families[0]) : { OR: families.map(per) };
}

export type GameCard = {
  id: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  /** Sources of the case art on the /jogos shelf, best first (see lib/case-art). */
  art: CaseArtSource[];
  platforms: string[];
  skills: SkillId[];
  achievementCount: number;
  /** Null when the visitor is anonymous or does not own the game. */
  unlockedCount: number | null;
  hasGuide: boolean;
  /** Name-only entry of the full catalog (found by name search only): "detalhes em breve". */
  stub: boolean;
};

/** Orders of /jogos: most popular (default), name, newest release first. */
export const CATALOG_SORTS = ["popular", "nome", "lancamento"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * Orders of the catalog. "Popular" and "Nome" read the (stub, popularity DESC, name) and
 * (stub, name) indexes with LIMIT (no aggregate: the hot path of every /jogos view and keystroke).
 */
const SORT_ORDER: Record<CatalogSort, Prisma.GameOrderByWithRelationInput[]> = {
  popular: [{ popularity: "desc" }, { name: "asc" }],
  nome: [{ name: "asc" }],
  lancamento: [{ releaseDate: { sort: "desc", nulls: "last" } }, { name: "asc" }],
};

/**
 * Shortest folded query that also searches name-only stubs (~150k names): shorter ones have no
 * trigram for the index, so they only search the games with details.
 */
export const STUB_SEARCH_MIN_LENGTH = 3;

export type CatalogPage = {
  items: GameCard[];
  /** Games matching the filters (all pages). */
  total: number;
  /** Clamped to the last page. */
  page: number;
  /** Matching stubs (only a name search finds them). */
  stubTotal: number;
};

/**
 * One page of the catalog (/jogos). Without a search, name-only stubs of the full catalog stay out
 * until their details are fetched; a name search (accents, case and punctuation ignored, over the
 * trigram index of `searchName`) finds them too, after the games with details.
 */
export async function listGames(
  filter: GameFilter,
  opts: { page?: number; perPage?: number; sort?: CatalogSort } = {},
  userId?: string,
): Promise<CatalogPage> {
  const perPage = opts.perPage ?? 40;
  const requested = Math.max(1, Math.floor(opts.page ?? 1));
  const empty: CatalogPage = { items: [], total: 0, page: 1, stubTotal: 0 };
  // "Almost" is relative to someone's progress: no user, no result.
  if (filter.almost && !userId) return empty;

  const and: Prisma.GameWhereInput[] = [];
  const q = filter.q?.trim();
  const folded = q ? await foldQueryInDb(q) : "";
  // The whole catalog is listed (games with details first, then name-only stubs) unless a filter
  // needs details (genre, guide, progress) or a too-short search would scan every stub name.
  const withStubs =
    !filter.skill && !filter.withGuide && !filter.almost && (!folded || folded.length >= STUB_SEARCH_MIN_LENGTH);
  if (folded) and.push({ searchName: { contains: folded } });
  if (!withStubs) and.push({ stub: false });
  if (filter.skill) and.push({ skills: { some: { skill: filter.skill } } });
  if (filter.withGuide) and.push({ guide: { is: { status: "published" } } });
  if (filter.platform || filter.exclusive || filter.withTrophies) and.push(catalogWhere(filter));
  if (filter.almost && userId) {
    // Steam progress against the Steam total, from the player's own library (bounded).
    const owned = await prisma.userGame.findMany({
      where: { userId, platform: "steam", unlockedCount: { gt: 0 } },
      select: { gameId: true, unlockedCount: true, game: { select: { achievementCount: true } } },
    });
    const ids = owned.filter((r) => isAlmostComplete(r.unlockedCount, r.game.achievementCount)).map((r) => r.gameId);
    if (ids.length === 0) return empty;
    and.push({ id: { in: ids } });
  }
  const where: Prisma.GameWhereInput = { AND: and };

  const [total, stubTotal] = await Promise.all([
    prisma.game.count({ where }),
    withStubs ? prisma.game.count({ where: { AND: [...and, { stub: true }] } }) : Promise.resolve(0),
  ]);
  if (total === 0) return empty;
  const page = Math.min(requested, Math.max(1, Math.ceil(total / perPage)));

  const games = await prisma.game.findMany({
    where,
    // Games with details come first; the id keeps pages stable on ties.
    orderBy: [...(withStubs ? [{ stub: "asc" as const }] : []), ...SORT_ORDER[opts.sort ?? "popular"], { id: "asc" }],
    skip: (page - 1) * perPage,
    take: perPage,
    include: {
      skills: true,
      guide: { select: { status: true } },
      // Steam progress (achievementCount is the Steam total).
      users: userId ? { where: { userId, platform: "steam" } } : false,
    },
  });

  return {
    total,
    page,
    stubTotal,
    items: games.map<GameCard>((game) => ({
      id: game.id,
      slug: game.slug,
      name: game.name,
      // Games still without details show the Steam store header (served by Steam's CDN by appid).
      coverUrl: game.coverUrl ?? (game.steamAppId ? steamHeaderUrl(game.steamAppId) : null),
      // Once the Steam details were fetched, a missing cover means Steam has no portrait either.
      art: caseArt({ coverUrl: game.coverUrl, steamAppId: game.steamAppId, portraitChecked: game.detailsSyncedAt !== null }),
      platforms: game.platforms,
      skills: asSkills(game.skills.map((s) => s.skill)),
      achievementCount: game.achievementCount,
      unlockedCount: game.users?.[0]?.unlockedCount ?? null,
      hasGuide: game.guide?.status === "published",
      stub: game.stub,
    })),
  };
}

/** Every game in the catalog, including the ones whose details are still being fetched. */
export function countGames(): Promise<number> {
  return prisma.game.count();
}

/** How many game pages (and guide pages) the build prerenders; the rest render on first request. */
export const PRERENDER_GAMES = 200;

/**
 * Slugs to prerender (generateStaticParams): the most played games first (players on the site,
 * then the most recently updated), capped so build time does not grow with the catalog.
 * Optionally only games with a published guide.
 */
export async function listGameSlugs(
  opts: { withGuide?: boolean; limit?: number } = {},
): Promise<string[]> {
  const games = await prisma.game.findMany({
    where: opts.withGuide ? { guide: { is: { status: "published" } } } : { stub: false },
    select: { slug: true },
    orderBy: [{ users: { _count: "desc" } }, { updatedAt: "desc" }, { slug: "asc" }],
    take: opts.limit ?? PRERENDER_GAMES,
  });
  return games.map((g) => g.slug);
}

// ---------- Game page ----------

export type GuideMeta = {
  /** Version of the latest real revision (`realRevisions`); null when there is none to show. */
  version: string | null;
  /** When readers last saw the guide change: the latest real revision, else its publication. */
  updatedAt: Date;
  /** What `updatedAt` is: a revision ("atualizado") or the publication ("publicado"). */
  dateKind: "updated" | "published";
  /** The author, when a real account (`isRealAccount`); seeded characters are not shown. */
  authorHandle: string | null;
  reviewers: string[];
  stepCount: number;
  /** An editorial guide by a real account: only then the page says "Autoria humana". */
  human: boolean;
};

/** Account fields that tell a person's account from a seeded character (never sent to pages). */
const ACCOUNT_SELECT = { handle: true, email: true, googleSub: true, passwordHash: true } as const;

/**
 * A person's account: one that can sign in with an e-mail, a password or Google. Seeded
 * characters (and nothing else) have none of them, so their guide revisions are not shown.
 */
export function isRealAccount(
  user: { email: string | null; googleSub: string | null; passwordHash: string | null } | null | undefined,
): boolean {
  return Boolean(user && (user.email || user.googleSub || user.passwordHash));
}

/**
 * The revisions a guide page may show, newest first: written by a real account, and not older
 * than the guide itself (a seeded history is backdated: "v1.0, há 1 ano" on a new site).
 */
export function realRevisions<
  R extends {
    createdAt: Date;
    author: { email: string | null; googleSub: string | null; passwordHash: string | null } | null;
  },
>(revisions: R[], guideCreatedAt: Date): R[] {
  return revisions
    .filter((r) => isRealAccount(r.author) && r.createdAt.getTime() >= guideCreatedAt.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type GameDetail = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  platforms: string[];
  skills: SkillId[];
  achievementCount: number;
  /** Wide art (the booklet cover of the guide head) and IGDB's 100% time. */
  heroUrl: string | null;
  timeToBeatCompleteMin: number | null;
  /** Null when the visitor is anonymous or does not own the game. */
  progress: { unlockedCount: number; playtimeMin: number } | null;
  /** Present only for published guides. */
  guide: GuideMeta | null;
  /** When this object was built; relative dates ("há 3 dias") are measured against it. */
  generatedAt: Date;
};

export async function getGame(slug: string, userId?: string): Promise<GameDetail | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    include: {
      skills: true,
      // Steam progress (achievementCount is the Steam total).
      users: userId ? { where: { userId, platform: "steam" } } : false,
      // The catalog cover art, as on the game page (Plan 4 F12: the guide header shows it).
      media: { where: { kind: "cover", url: { not: null } }, orderBy: { order: "asc" }, take: 1, select: { url: true } },
      guide: {
        include: {
          author: { select: ACCOUNT_SELECT },
          revisions: { include: { author: { select: ACCOUNT_SELECT } } },
          _count: { select: { steps: true } },
        },
      },
      // The Steam total is the catalog count, else its rows (achievementTotal, as the game page).
      _count: { select: { achievements: { where: { platform: "steam" } } } },
    },
  });
  if (!game) return null;

  const guide = game.guide?.status === "published" ? game.guide : null;
  const realAuthor = isRealAccount(guide?.author);
  const authorHandle = realAuthor ? (guide?.author?.handle ?? null) : null;
  const revisions = guide ? realRevisions(guide.revisions, guide.createdAt) : [];
  const reviewers = [
    ...new Set(
      revisions.map((r) => r.author?.handle).filter((h): h is string => Boolean(h) && h !== authorHandle),
    ),
  ];
  const latest = revisions[0] ?? null;
  // Never before the guide row existed (a seeded publication date can be backdated too).
  const published = guide
    ? new Date(Math.max(guide.createdAt.getTime(), guide.publishedAt?.getTime() ?? 0))
    : null;
  const owned = game.users?.[0];

  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    summary: game.summary,
    coverUrl: safeImageUrl(game.media[0]?.url) ?? safeImageUrl(game.coverUrl),
    platforms: game.platforms,
    skills: asSkills(game.skills.map((s) => s.skill)),
    achievementCount: achievementTotal("steam", game.achievementCount, game._count.achievements),
    heroUrl: safeImageUrl(game.heroUrl),
    timeToBeatCompleteMin: game.timeToBeatCompleteMin,
    progress: owned ? { unlockedCount: owned.unlockedCount, playtimeMin: owned.playtimeMin } : null,
    generatedAt: new Date(),
    guide: guide
      ? {
          version: latest?.version ?? null,
          updatedAt: latest?.createdAt ?? published!,
          dateKind: latest ? "updated" : "published",
          authorHandle,
          reviewers,
          stepCount: guide._count.steps,
          human: guide.source !== "bot" && realAuthor,
        }
      : null,
  };
}

/** Lightweight lookup used by generateMetadata. */
export async function getGameTitle(
  slug: string,
): Promise<{ name: string; hasGuide: boolean } | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { name: true, guide: { select: { status: true } } },
  });
  return game ? { name: game.name, hasGuide: game.guide?.status === "published" } : null;
}

// ---------- Guide page ----------

const collectiblesSchema = z.array(
  z.object({ name: z.string(), total: z.number(), description: z.string().default("") }),
);

export type Collectible = z.infer<typeof collectiblesSchema>[number];

export type GuideFacts = {
  difficulty: number;
  /**
   * Time to 100%, the same number and source as the game page (Tralked players' median, else
   * IGDB). The editor's own hours range (Guide.hoursMin/hoursMax) is not shown: it was no
   * measurement of the community.
   */
  timeTo100: TimeTo100 | null;
  playthroughs: string;
  missables: number;
  online: number;
};

export type GuideStepView = {
  id: string;
  /** Stable key a bot gives the step (format-2 chapters point at it with `phaseKey`). */
  key: string | null;
  order: number;
  title: string;
  hours: string;
  /** Plain text (always set): shown when `blocks` is null. */
  body: string;
  /** Rich body (bot guides), validated ContentBlock[]; null for plain-text steps. */
  blocks: ContentBlock[] | null;
  /** Resolved `achievement` blocks of `blocks`. */
  cards: Record<string, AchievementCardData>;
  achievements: { id: string; name: string; tier: RarityTier; done: boolean }[];
  done: boolean;
};

export type GuideAchievementView = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  spoiler: boolean;
  /** Plain text (always set): shown when `tipBlocks` is null. */
  tip: string;
  /** Rich tip (bot guides), validated ContentBlock[]; null for plain-text tips. */
  tipBlocks: ContentBlock[] | null;
  /** Resolved `achievement` blocks of `tipBlocks`. */
  cards: Record<string, AchievementCardData>;
  steps: string[];
  globalPct: number | null;
  tier: RarityTier;
  xp: number;
  done: boolean;
};

export type GuideTipView = {
  id: string;
  body: string;
  votes: number;
  authorHandle: string | null;
  authorLevel: number | null;
  isOwn: boolean;
  voted: boolean;
};

export type GuideSource = { title: string; url: string };

/** Guide.sources is untyped JSON: keeps only `{ title, url }` items with an http(s) URL. */
export function parseGuideSources(value: unknown): GuideSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { title, url } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string" || !title.trim() || !isSafeHttpUrl(url)) return [];
    return [{ title: title.trim(), url }];
  });
}

/** Stored step/tip blocks: null when absent, empty or not a valid ContentBlock[] (plain text is shown). */
function richBlocks(value: unknown): ContentBlock[] | null {
  const blocks = parseStoredBlocks(value);
  return blocks && blocks.length > 0 ? blocks : null;
}

/** Card data for the `achievement` blocks of `blocks`, looked up among the game's achievements. */
function cardsFor(
  blocks: ContentBlock[] | null,
  byKey: Map<string, AchievementCardData>,
): Record<string, AchievementCardData> {
  const out: Record<string, AchievementCardData> = {};
  for (const block of blocks ?? []) {
    if (block.type !== "achievement") continue;
    const key = achievementKey(block.platform, block.apiName);
    const card = byKey.get(key);
    if (card) out[key] = card;
  }
  return out;
}

export type GuideRevisionView = {
  id: string;
  version: string;
  summary: string;
  authorHandle: string | null;
  createdAt: Date;
};

/**
 * A Steam achievement of a format-2 guide. A hidden one (Steam `hidden`) carries no name,
 * description or icon: they are fetched only when the reader reveals it (reveal-achievement).
 */
export type WalkAchievementView = {
  id: string;
  apiName: string;
  /** PT-BR name (Steam l=brazilian), else the English one; null when hidden. */
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  globalPct: number | null;
  hidden: boolean;
  xp: number;
  done: boolean;
};

/** What a format-2 page needs besides the walkthrough itself. */
export type WalkExtras = {
  guideId: string;
  steamAppId: number | null;
  /** Official logo of the game, when the catalog has one. */
  logoUrl: string | null;
  /** The guide's own estimate (Guide.hoursMin/hoursMax). */
  hours: { min: number; max: number };
  hiddenCount: number;
  /** The game's Steam achievements by apiName. */
  achievements: Record<string, WalkAchievementView>;
  /** The rarest achievement the robot named (`extraFacts.hardest`). */
  hardest: WalkAchievementView | null;
  /** Steam vs PlayStation list sizes, from the robot report, for the "APENAS STEAM" seal. */
  compatCounts: { steam: number; psn: number } | null;
  /** Up to 4 official screenshots of the game, for the animated backdrop. */
  screenshots: string[];
};

export type GuideDetail = {
  game: GameDetail & { guide: GuideMeta };
  /** 1 = classic guide (steps + notes); 2 = walkthrough (the guide robot). */
  format: number;
  /** Format 2: the validated walkthrough; null for format 1 or when the stored one is invalid. */
  walkthrough: Walkthrough | null;
  /** Format 2: edition number of the magazine cover (assigned on first publication). */
  edition: number | null;
  compat: GuideCompat | null;
  /** The robot report. Staff only: always null in the public guide (see loadGuideReport). */
  report: GuideReport | null;
  /** Format 2 only. */
  walk: WalkExtras | null;
  /** Keys of the walkthrough items the visitor ticked (empty in the public guide). */
  itemsDone: Set<string>;
  facts: GuideFacts;
  overview: string[];
  warnings: string[];
  collectibles: Collectible[];
  steps: GuideStepView[];
  achievements: GuideAchievementView[];
  tips: GuideTipView[];
  revisions: GuideRevisionView[];
  /** References the guide was written from (bot guides): only http(s) links. */
  sources: GuideSource[];
  totals: { xp: number; pendingCount: number; pendingXp: number };
  /** The game's skills with the visitor's level (null when anonymous). */
  skillLevels: { skill: SkillId; level: number | null }[];
};


/**
 * The guide as every visitor sees it (no per-user marks): safe to cache and to prerender.
 * Null when the game has no published guide.
 */
export async function getGuidePublic(slug: string): Promise<GuideDetail | null> {
  const game = await getGame(slug);
  if (!game || !game.guide) return null;
  return buildGuide(game, game.guide);
}

/**
 * A walkthrough (format 2) that is not published yet (the robot's guides wait in `review`), as staff
 * preview it on the guide page. Callers check the role first; never cache it.
 */
export async function getGuidePreview(slug: string): Promise<GuideDetail | null> {
  const game = await getGame(slug);
  if (!game || game.guide) return null;
  const row = await prisma.guide.findUnique({
    where: { gameId: game.id },
    select: { format: true, updatedAt: true, _count: { select: { steps: true } } },
  });
  if (!row || row.format !== 2) return null;
  return buildGuide(game, {
    version: null,
    updatedAt: row.updatedAt,
    dateKind: "updated",
    authorHandle: null,
    reviewers: [],
    stepCount: row._count.steps,
    human: false,
  });
}

/** Whether the game has a walkthrough that is not published (what staff can preview). */
export async function hasGuidePreview(slug: string): Promise<boolean> {
  const guide = await prisma.guide.findFirst({
    where: { game: { slug }, format: 2, status: { not: "published" } },
    select: { id: true },
  });
  return guide !== null;
}

async function buildGuide(game: GameDetail, meta: GuideMeta): Promise<GuideDetail> {
  const guide = await prisma.guide.findUniqueOrThrow({
    where: { gameId: game.id },
    include: {
      steps: { orderBy: { order: "asc" } },
      notes: { include: { achievement: true } },
      tips: {
        orderBy: [{ votes: "desc" }, { createdAt: "asc" }],
        include: { author: { select: { handle: true, stats: { select: { level: true } } } } },
      },
      revisions: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: ACCOUNT_SELECT } },
      },
    },
  });

  // Achievements referenced by steps (by apiName) may include ones without a guide note.
  const stepApiNames = [...new Set(guide.steps.flatMap((s) => s.achievementApiNames))];
  const stepAchievements = stepApiNames.length
    ? await prisma.achievement.findMany({
        // Guide steps name Steam achievements (apiNames repeat across platforms).
        where: { gameId: game.id, platform: "steam", apiName: { in: stepApiNames } },
      })
    : [];
  const byApiName = new Map(stepAchievements.map((a) => [a.apiName, a]));

  // Rich step bodies / tips (bot guides) and the achievements their `achievement` blocks name.
  const stepBlocks = new Map(guide.steps.map((s) => [s.id, richBlocks(s.blocks)]));
  const tipBlocks = new Map(guide.notes.map((n) => [n.id, richBlocks(n.tipBlocks)]));
  const refs = [...stepBlocks.values(), ...tipBlocks.values()].flatMap((blocks) =>
    (blocks ?? []).flatMap((b) => (b.type === "achievement" ? [{ platform: b.platform, apiName: b.apiName }] : [])),
  );
  const referenced = refs.length
    ? await prisma.achievement.findMany({
        where: { gameId: game.id, OR: refs },
        select: { platform: true, apiName: true, name: true, description: true, globalPct: true },
      })
    : [];
  const cardByKey = new Map(
    referenced.map((a) => [
      achievementKey(a.platform as AchievementPlatform, a.apiName),
      { name: a.name, description: a.description, globalPct: a.globalPct, gameName: game.name },
    ]),
  );

  const achievements = guide.notes
    .map<GuideAchievementView>((note) => {
      const a = note.achievement;
      const blocks = tipBlocks.get(note.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        category: note.category,
        spoiler: note.spoiler,
        tip: note.tip,
        tipBlocks: blocks,
        cards: cardsFor(blocks, cardByKey),
        steps: note.steps,
        globalPct: a.globalPct,
        tier: rarityTier(a.globalPct ?? 50),
        xp: xpForAchievement(a.globalPct),
        done: false,
      };
    })
    // Most common (easiest) first, rarest last.
    .sort((a, b) => (b.globalPct ?? 50) - (a.globalPct ?? 50));

  const steps = guide.steps.map<GuideStepView>((step) => ({
    id: step.id,
    key: step.key,
    order: step.order,
    title: step.title,
    hours: step.hours,
    body: step.body,
    blocks: stepBlocks.get(step.id) ?? null,
    cards: cardsFor(stepBlocks.get(step.id) ?? null, cardByKey),
    achievements: step.achievementApiNames.flatMap((apiName) => {
      const a = byApiName.get(apiName);
      return a ? [{ id: a.id, name: a.name, tier: rarityTier(a.globalPct ?? 50), done: false }] : [];
    }),
    done: false,
  }));

  const parsedWalk = guide.format === 2 ? walkthroughSchema.safeParse(guide.walkthrough) : null;
  // The robot's older text still talks about its sources to the reader (source-talk.ts).
  const walkthrough = parsedWalk?.success ? quietSources(parsedWalk.data) : null;
  if (parsedWalk && !parsedWalk.success) {
    // The page shows "guia indisponível" (never the classic layout over a walkthrough's data).
    console.error(
      `walkthrough inválido no guia ${guide.id} (${game.slug})`,
      parsedWalk.error.issues.slice(0, 5).map((i) => `${i.path.join("/")}: ${i.message}`),
    );
  }
  const walk = walkthrough ? await loadWalkExtras(game.id, guide, walkthrough) : null;
  // A walkthrough covers the whole Steam list; a classic guide, the achievements it explains.
  const xpOf = walk ? Object.values(walk.achievements) : achievements;
  const totalXp = xpOf.reduce((sum, a) => sum + a.xp, 0);

  return {
    game: { ...game, guide: meta },
    format: guide.format,
    walkthrough,
    edition: guide.edition,
    compat: (GUIDE_COMPAT as readonly string[]).includes(guide.compat ?? "") ? (guide.compat as GuideCompat) : null,
    report: null,
    walk,
    itemsDone: new Set<string>(),
    facts: {
      difficulty: guide.difficulty,
      timeTo100: await loadTimeTo100(game.id, game.timeToBeatCompleteMin),
      playthroughs: guide.playthroughs,
      missables: guide.missables,
      online: guide.online,
    },
    overview: guide.format === 2 ? quietSources(guide.overview) : guide.overview,
    warnings: guide.warnings,
    collectibles: parseCollectibles(guide.collectibles),
    steps: guide.format === 2 ? quietSources(steps) : steps,
    achievements,
    tips: guide.tips.map((tip) => ({
      id: tip.id,
      body: tip.body,
      votes: tip.votes,
      authorHandle: tip.author?.handle ?? null,
      authorLevel: tip.author?.stats?.level ?? null,
      isOwn: false,
      voted: false,
    })),
    revisions: realRevisions(guide.revisions, guide.createdAt).map((r) => ({
      id: r.id,
      version: r.version,
      summary: r.summary,
      authorHandle: r.author?.handle ?? null,
      createdAt: r.createdAt,
    })),
    sources: parseGuideSources(guide.sources),
    totals: { xp: totalXp, pendingCount: xpOf.length, pendingXp: totalXp },
    skillLevels: game.skills.map((skill) => ({ skill, level: null })),
  };
}

/** Steam achievements, hardest and seal counts of a format-2 guide. */
async function loadWalkExtras(
  gameId: string,
  guide: { id: string; hoursMin: number; hoursMax: number; report: unknown },
  walkthrough: Walkthrough,
): Promise<WalkExtras> {
  const [game, rows, shots] = await Promise.all([
    prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { steamAppId: true, logoUrl: true } }),
    prisma.achievement.findMany({
      where: { gameId, platform: "steam" },
      select: {
        id: true,
        apiName: true,
        name: true,
        namePt: true,
        description: true,
        descriptionPt: true,
        iconUrl: true,
        globalPct: true,
        hidden: true,
      },
    }),
    prisma.gameMedia.findMany({
      where: { gameId, kind: "screenshot", url: { not: null } },
      orderBy: { order: "asc" },
      take: 4,
      select: { url: true },
    }),
  ]);
  const achievements: Record<string, WalkAchievementView> = {};
  for (const a of rows) {
    achievements[a.apiName] = {
      id: a.id,
      apiName: a.apiName,
      name: a.hidden ? null : (a.namePt ?? a.name),
      description: a.hidden ? null : (a.descriptionPt ?? a.description),
      iconUrl: a.hidden ? null : safeImageUrl(a.iconUrl),
      globalPct: a.globalPct,
      hidden: a.hidden,
      xp: xpForAchievement(a.globalPct),
      done: false,
    };
  }
  // Only the two list sizes leave the report: the report itself is staff only.
  const coverage = parseReport(guide.report)?.coverage;
  const hardest = walkthrough.extraFacts.hardest;
  return {
    guideId: guide.id,
    steamAppId: game.steamAppId,
    logoUrl: safeImageUrl(game.logoUrl),
    hours: { min: guide.hoursMin, max: guide.hoursMax },
    hiddenCount: rows.filter((a) => a.hidden).length,
    achievements,
    hardest: hardest ? (achievements[hardest.apiName] ?? null) : null,
    // The PlayStation list's own size when the report has it (it counts the platinum, which Steam has not);
    // older reports only say how many Steam achievements are missing from it.
    compatCounts:
      coverage?.psn !== undefined
        ? { steam: coverage.steam, psn: coverage.psn }
        : coverage && coverage.steamOnly > 0
          ? { steam: coverage.steam, psn: coverage.steam - coverage.steamOnly }
          : null,
    screenshots: shots.flatMap((m) => {
      const url = safeImageUrl(m.url);
      return url ? [url] : [];
    }),
  };
}

/** The robot report of a guide. Staff only: callers check the role first. */
export async function loadGuideReport(guideId: string): Promise<GuideReport | null> {
  const guide = await prisma.guide.findUnique({ where: { id: guideId }, select: { report: true } });
  return parseReport(guide?.report);
}

// ---------- Per-user overlay of the guide ----------

/** What a signed-in visitor adds on top of the public guide. */
export type GuideUserState = {
  progress: GameDetail["progress"];
  unlockedAchievementIds: string[];
  doneStepIds: string[];
  /** Walkthrough items (format 2) the visitor ticked, by item key. */
  doneItemKeys: string[];
  votedTipIds: string[];
  ownTipIds: string[];
  skillLevels: Record<string, number>;
};

export async function loadGuideUserState(
  guide: GuideDetail,
  userId: string,
): Promise<GuideUserState> {
  const achievementIds = [
    ...new Set([
      ...guide.achievements.map((a) => a.id),
      ...guide.steps.flatMap((s) => s.achievements.map((a) => a.id)),
      ...Object.values(guide.walk?.achievements ?? {}).map((a) => a.id),
    ]),
  ];
  const [owned, unlocks, stepProgress, itemProgress, votes, ownTips, skillRows] = await Promise.all([
    prisma.userGame.findUnique({
      where: { userId_gameId_platform: { userId, gameId: guide.game.id, platform: "steam" } },
    }),
    prisma.userAchievement.findMany({
      where: { userId, achievementId: { in: achievementIds } },
      select: { achievementId: true },
    }),
    prisma.guideStepProgress.findMany({
      where: { userId, stepId: { in: guide.steps.map((s) => s.id) } },
      select: { stepId: true },
    }),
    guide.walk
      ? prisma.guideItemProgress.findMany({
          where: { userId, guideId: guide.walk.guideId },
          select: { itemKey: true },
        })
      : Promise.resolve([]),
    prisma.guideVote.findMany({
      where: { userId, tipId: { in: guide.tips.map((t) => t.id) } },
      select: { tipId: true },
    }),
    prisma.guideTip.findMany({
      where: { id: { in: guide.tips.map((t) => t.id) }, authorId: userId },
      select: { id: true },
    }),
    prisma.skillProgress.findMany({
      where: { userId, skill: { in: guide.game.skills } },
    }),
  ]);

  return {
    progress: owned ? { unlockedCount: owned.unlockedCount, playtimeMin: owned.playtimeMin } : null,
    unlockedAchievementIds: unlocks.map((u) => u.achievementId),
    doneStepIds: stepProgress.map((s) => s.stepId),
    doneItemKeys: itemProgress.map((i) => i.itemKey),
    votedTipIds: votes.map((v) => v.tipId),
    ownTipIds: ownTips.map((t) => t.id),
    skillLevels: Object.fromEntries(skillRows.map((s) => [s.skill, s.level])),
  };
}

/** Pure merge of the public guide with one visitor's progress. */
export function applyGuideUserState(guide: GuideDetail, state: GuideUserState): GuideDetail {
  const unlocked = new Set(state.unlockedAchievementIds);
  const doneSteps = new Set(state.doneStepIds);
  const voted = new Set(state.votedTipIds);
  const own = new Set(state.ownTipIds);

  const achievements = guide.achievements.map((a) => ({ ...a, done: unlocked.has(a.id) }));
  const walk = guide.walk
    ? {
        ...guide.walk,
        achievements: Object.fromEntries(
          Object.entries(guide.walk.achievements).map(([apiName, a]) => [apiName, { ...a, done: unlocked.has(a.id) }]),
        ),
        hardest: guide.walk.hardest ? { ...guide.walk.hardest, done: unlocked.has(guide.walk.hardest.id) } : null,
      }
    : null;
  const pending = (walk ? Object.values(walk.achievements) : achievements).filter((a) => !a.done);

  return {
    ...guide,
    game: { ...guide.game, progress: state.progress },
    walk,
    itemsDone: new Set(state.doneItemKeys),
    steps: guide.steps.map((step) => ({
      ...step,
      done: doneSteps.has(step.id),
      achievements: step.achievements.map((a) => ({ ...a, done: unlocked.has(a.id) })),
    })),
    achievements,
    tips: guide.tips.map((tip) => ({
      ...tip,
      voted: voted.has(tip.id),
      isOwn: own.has(tip.id),
    })),
    totals: {
      ...guide.totals,
      pendingCount: pending.length,
      pendingXp: pending.reduce((sum, a) => sum + a.xp, 0),
    },
    skillLevels: guide.skillLevels.map(({ skill }) => ({
      skill,
      level: state.skillLevels[skill] ?? 1,
    })),
  };
}

/** Full guide with the visitor's progress per achievement and step. Null when there is no published guide. */
export async function getGuide(slug: string, userId?: string): Promise<GuideDetail | null> {
  const guide = await getGuidePublic(slug);
  if (!guide || !userId) return guide;
  return applyGuideUserState(guide, await loadGuideUserState(guide, userId));
}

function parseCollectibles(value: unknown): Collectible[] {
  const parsed = collectiblesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
