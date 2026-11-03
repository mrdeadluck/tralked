import type { Prisma } from "@/generated/prisma/client";
import { parseReport } from "@/lib/admin/guide-report";
import { walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { prisma } from "@/lib/db";

/**
 * Cache tag of the lists of published guides (the home's "Novos guias" card). Every guide write
 * that can put a guide on the site, change a published one or take it off expires it.
 */
export const GUIDES_TAG = "guides";

/** Platform whose list a guide covers: the card's seals. */
export type HomeGuideSeal = "steam" | "psn" | "xbox";

/** A published guide as the home card shows it. */
export type HomeGuideView = {
  id: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  heroUrl: string | null;
  steamAppId: number | null;
  /** The store details were fetched (no Steam portrait to guess, see lib/case-art). */
  portraitChecked: boolean;
  href: string;
  /** walkthrough = format 2 (the guide robot); classic = format 1. */
  kind: "walkthrough" | "classic";
  /** "Detonado completo · 20 capítulos · 36 troféus PSN", "Guia 100% · 66 conquistas Steam". */
  line: string;
  seals: HomeGuideSeal[];
  publishedAt: Date;
};

const GUIDE_SELECT = {
  id: true,
  format: true,
  compat: true,
  walkthrough: true,
  report: true,
  publishedAt: true,
  updatedAt: true,
  game: {
    select: {
      slug: true,
      name: true,
      coverUrl: true,
      heroUrl: true,
      steamAppId: true,
      detailsSyncedAt: true,
      _count: { select: { achievements: { where: { platform: "steam" } } } },
    },
  },
} as const satisfies Prisma.GuideSelect;

type Row = Prisma.GuideGetPayload<{ select: typeof GUIDE_SELECT }>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const steamCount = (n: number) => plural(n, "conquista Steam", "conquistas Steam");

/** Which other lists the Steam list also covers (Guide.compat). */
const COMPAT_SEALS: Record<string, HomeGuideSeal[]> = {
  steam_only: ["steam"],
  psn: ["steam", "psn"],
  xbox: ["steam", "xbox"],
  psn_xbox: ["steam", "psn", "xbox"],
};

/**
 * Line and seals of a guide, from what is stored only: the walkthrough's chapters and lists, the
 * report's Steam coverage, the game's Steam achievements. Null for a walkthrough the guide page
 * cannot show (it fails the schema there too: "guia indisponível").
 */
function describeGuide(row: Row): Pick<HomeGuideView, "kind" | "line" | "seals"> | null {
  const steam = row.game._count.achievements;
  if (row.format !== 2) {
    return {
      kind: "classic",
      line: steam > 0 ? `Guia 100% · ${steamCount(steam)}` : "Guia 100%",
      seals: steam > 0 ? ["steam"] : [],
    };
  }
  const parsed = walkthroughSchema.safeParse(row.walkthrough);
  if (!parsed.success) return null;
  const walk = parsed.data;
  const parts = ["Detonado completo", plural(walk.chapters.length, "capítulo", "capítulos")];
  // A guide written from the PSN list (R22) follows its trophies, not the whole Steam list.
  if (walk.scope === "psn" && walk.psnList) {
    parts.push(plural(walk.psnList.total, "troféu PSN", "troféus PSN"));
    return { kind: "walkthrough", line: parts.join(" · "), seals: ["psn"] };
  }
  const covered = parseReport(row.report)?.coverage?.steam ?? steam;
  if (covered > 0) parts.push(steamCount(covered));
  return { kind: "walkthrough", line: parts.join(" · "), seals: COMPAT_SEALS[row.compat ?? walk.compat] ?? ["steam"] };
}

const newestFirst = [{ publishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] as const satisfies Prisma.GuideOrderByWithRelationInput[];

/**
 * The most recently published guides for the home: walkthroughs (format 2) first, then classic
 * guides, newest first in each. Empty when nothing is published.
 */
export async function getHomeGuides(limit = 4): Promise<HomeGuideView[]> {
  const [walkthroughs, classics] = await Promise.all([
    // A few extra walkthroughs, in case a stored one is unreadable and is left out.
    prisma.guide.findMany({ where: { status: "published", format: 2 }, orderBy: newestFirst, take: limit + 4, select: GUIDE_SELECT }),
    prisma.guide.findMany({ where: { status: "published", format: { not: 2 } }, orderBy: newestFirst, take: limit, select: GUIDE_SELECT }),
  ]);
  return [...walkthroughs, ...classics]
    .flatMap((row) => {
      const described = describeGuide(row);
      if (!described) return [];
      const { game } = row;
      return [
        {
          id: row.id,
          slug: game.slug,
          name: game.name,
          coverUrl: game.coverUrl,
          heroUrl: game.heroUrl,
          steamAppId: game.steamAppId,
          portraitChecked: game.detailsSyncedAt !== null,
          href: `/jogos/${game.slug}/guia`,
          ...described,
          publishedAt: row.publishedAt ?? row.updatedAt,
        },
      ];
    })
    .slice(0, limit);
}
