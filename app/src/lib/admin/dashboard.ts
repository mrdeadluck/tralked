import { prisma } from "@/lib/db";

/** What is waiting for the newsroom and the admins (dashboard of /admin). */
export type AdminQueues = {
  articlesInReview: number;
  botArticlesInReview: number;
  guidesInReview: number;
  openReports: number;
  /** Players with suspicious unlocks nobody decided on yet. */
  fraudUsers: number;
  activeKeys: number;
  rejectedLastDay: number;
  drafts: number;
};

const DAY_MS = 86_400_000;

export async function adminQueues(now: Date = new Date()): Promise<AdminQueues> {
  const [articlesInReview, botArticlesInReview, guidesInReview, openReports, fraud, activeKeys, rejectedLastDay, drafts] =
    await Promise.all([
      prisma.article.count({ where: { status: "review" } }),
      prisma.article.count({ where: { status: "review", source: "bot" } }),
      prisma.guide.count({ where: { status: "review" } }),
      prisma.report.count({ where: { status: "open" } }),
      prisma.userAchievement.findMany({
        where: { suspicious: true, fraudReview: null },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.apiKey.count({ where: { revokedAt: null } }),
      prisma.ingestionLog.count({ where: { status: "rejected", createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
      prisma.article.count({ where: { status: "draft" } }),
    ]);
  return {
    articlesInReview,
    botArticlesInReview,
    guidesInReview,
    openReports,
    fraudUsers: fraud.length,
    activeKeys,
    rejectedLastDay,
    drafts,
  };
}
