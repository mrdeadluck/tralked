-- Engagement (items 09, 11, 17): comment replies, article view counter, likes/dislikes on
-- articles, comments, photos and guides. Additive only: new columns have constant defaults
-- (metadata-only in Postgres 11+), new tables start empty except Reaction, which receives a
-- copy of the existing photo likes. PhotoLike itself is left untouched (no longer used).

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "dislikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "dislikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "replyToUserId" TEXT;

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "dislikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "dislikeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ArticleViewDaily" (
    "articleId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticleViewDaily_pkey" PRIMARY KEY ("articleId","day")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "targetOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("userId","targetType","targetId")
);

-- CreateIndex
CREATE INDEX "ArticleViewDaily_day_idx" ON "ArticleViewDaily"("day");

-- CreateIndex
CREATE INDEX "Reaction_targetType_targetId_value_idx" ON "Reaction"("targetType", "targetId", "value");

-- CreateIndex
CREATE INDEX "Reaction_targetOwnerId_value_idx" ON "Reaction"("targetOwnerId", "value");

-- CreateIndex
CREATE INDEX "Comment_parentId_createdAt_idx" ON "Comment"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArticleViewDaily" ADD CONSTRAINT "ArticleViewDaily_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_replyToUserId_fkey" FOREIGN KEY ("replyToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_targetOwnerId_fkey" FOREIGN KEY ("targetOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only the values the code writes (string "enums" elsewhere are checked in code; these two are
-- cheap to enforce and protect the counters).
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_value_check" CHECK ("value" IN (1, -1));
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_targetType_check"
  CHECK ("targetType" IN ('article', 'comment', 'photo', 'guide'));
ALTER TABLE "ArticleViewDaily" ADD CONSTRAINT "ArticleViewDaily_count_check" CHECK ("count" >= 0);

-- Existing photo likes become reactions (value 1). Photo.likeCount already equals them, so no
-- counter changes. The photo author at the time of the migration is the owner of the like.
INSERT INTO "Reaction" ("userId", "targetType", "targetId", "value", "targetOwnerId", "createdAt")
SELECT pl."userId", 'photo', pl."photoId", 1, p."authorId", pl."createdAt"
FROM "PhotoLike" pl
JOIN "Photo" p ON p."id" = pl."photoId"
ON CONFLICT DO NOTHING;
