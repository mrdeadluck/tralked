-- Tralked Plan 2: the single schema migration of the plan.
-- Hand-edited data steps (marked "Data:") keep existing rows valid: existing achievements and
-- library rows become platform 'steam', existing articles stay published (with their markdown
-- body; `blocks` starts empty and is filled by the editor/seed), the legacy Article.gameId is
-- copied into ArticleGame, and every user's Steam account gets its LinkedAccount row.

-- DropIndex
DROP INDEX "Achievement_gameId_apiName_key";

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "hardcore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'steam',
ADD COLUMN     "points" INTEGER,
ADD COLUMN     "trophyTier" TEXT;

-- AlterTable
-- Data: existing articles are published; `status` then defaults to 'draft' for new rows.
-- `updatedAt` (@updatedAt, no database default) is backfilled with the publication time.
ALTER TABLE "Article" ADD COLUMN     "blocks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "botKeyId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "excerpt" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "publishedAt" SET DEFAULT CURRENT_TIMESTAMP;
UPDATE "Article" SET "createdAt" = "publishedAt", "updatedAt" = "publishedAt", "source" = 'editorial';
ALTER TABLE "Article" ALTER COLUMN "status" SET DEFAULT 'draft',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "developer" TEXT,
ADD COLUMN     "publisher" TEXT,
ALTER COLUMN "steamAppId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "botKeyId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "despertarShownAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "googleSub" TEXT,
ALTER COLUMN "steamId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "UserAchievement" ADD COLUMN     "hardcore" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Data: existing library rows are Steam ones (column default).
ALTER TABLE "UserGame" DROP CONSTRAINT "UserGame_pkey",
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'steam',
ADD CONSTRAINT "UserGame_pkey" PRIMARY KEY ("userId", "gameId", "platform");

-- AlterTable
ALTER TABLE "XpLedgerEntry" ADD COLUMN     "platform" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LinkedAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifyCode" TEXT,
    "verifyExpiresAt" TIMESTAMP(3),
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlatformLink" (
    "gameId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "GamePlatformLink_pkey" PRIMARY KEY ("platform","externalId")
);

-- CreateTable
CREATE TABLE "GameMedia" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "youtubeId" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "source" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GameMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameOpen" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameOpen_pkey" PRIMARY KEY ("userId","gameId")
);

-- CreateTable
CREATE TABLE "AttributeProgress" (
    "userId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "AttributeProgress_pkey" PRIMARY KEY ("userId","attribute")
);

-- CreateTable
CREATE TABLE "GuideVersion" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleGame" (
    "articleId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,

    CONSTRAINT "ArticleGame_pkey" PRIMARY KEY ("articleId","gameId")
);

-- CreateTable
CREATE TABLE "ExternalNews" (
    "id" TEXT NOT NULL,
    "gameId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalNews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsFeed" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NewsFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumThread" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "gameId" TEXT,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "solvedPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForumThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'visible',

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "gameId" TEXT,
    "url" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "caption" TEXT,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoLike" (
    "userId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoLike_pkey" PRIMARY KEY ("userId","photoId")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionLog" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultId" TEXT,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedAccount_platform_lastSyncAttemptAt_idx" ON "LinkedAccount"("platform", "lastSyncAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedAccount_platform_externalId_key" ON "LinkedAccount"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedAccount_userId_platform_key" ON "LinkedAccount"("userId", "platform");

-- CreateIndex
CREATE INDEX "GamePlatformLink_gameId_idx" ON "GamePlatformLink"("gameId");

-- CreateIndex
CREATE INDEX "GameMedia_gameId_kind_order_idx" ON "GameMedia"("gameId", "kind", "order");

-- CreateIndex
CREATE INDEX "AttributeProgress_attribute_level_points_idx" ON "AttributeProgress"("attribute", "level", "points");

-- CreateIndex
CREATE UNIQUE INDEX "GuideVersion_guideId_version_key" ON "GuideVersion"("guideId", "version");

-- CreateIndex
CREATE INDEX "ArticleGame_gameId_idx" ON "ArticleGame"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalNews_url_key" ON "ExternalNews"("url");

-- CreateIndex
CREATE INDEX "ExternalNews_gameId_publishedAt_idx" ON "ExternalNews"("gameId", "publishedAt");

-- CreateIndex
CREATE INDEX "ExternalNews_publishedAt_idx" ON "ExternalNews"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsFeed_url_key" ON "NewsFeed"("url");

-- CreateIndex
CREATE INDEX "Comment_targetType_targetId_createdAt_idx" ON "Comment"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_slug_key" ON "ForumCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ForumThread_solvedPostId_key" ON "ForumThread"("solvedPostId");

-- CreateIndex
CREATE INDEX "ForumThread_categoryId_pinned_lastPostAt_idx" ON "ForumThread"("categoryId", "pinned", "lastPostAt");

-- CreateIndex
CREATE INDEX "ForumThread_gameId_lastPostAt_idx" ON "ForumThread"("gameId", "lastPostAt");

-- CreateIndex
CREATE INDEX "ForumPost_threadId_createdAt_idx" ON "ForumPost"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorId_createdAt_idx" ON "ForumPost"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_status_createdAt_idx" ON "Photo"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_authorId_createdAt_idx" ON "Photo"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_gameId_createdAt_idx" ON "Photo"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoLike_photoId_idx" ON "PhotoLike"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "IngestionLog_createdAt_idx" ON "IngestionLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionLog_keyId_idempotencyKey_key" ON "IngestionLog"("keyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_gameId_platform_apiName_key" ON "Achievement"("gameId", "platform", "apiName");

-- CreateIndex
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- AddForeignKey
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlatformLink" ADD CONSTRAINT "GamePlatformLink_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMedia" ADD CONSTRAINT "GameMedia_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOpen" ADD CONSTRAINT "GameOpen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOpen" ADD CONSTRAINT "GameOpen_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeProgress" ADD CONSTRAINT "AttributeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_botKeyId_fkey" FOREIGN KEY ("botKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideVersion" ADD CONSTRAINT "GuideVersion_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideVersion" ADD CONSTRAINT "GuideVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_botKeyId_fkey" FOREIGN KEY ("botKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleGame" ADD CONSTRAINT "ArticleGame_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleGame" ADD CONSTRAINT "ArticleGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalNews" ADD CONSTRAINT "ExternalNews_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ForumCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_solvedPostId_fkey" FOREIGN KEY ("solvedPostId") REFERENCES "ForumPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoLike" ADD CONSTRAINT "PhotoLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoLike" ADD CONSTRAINT "PhotoLike_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLog" ADD CONSTRAINT "IngestionLog_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the legacy single game of each article becomes its first ArticleGame link.
INSERT INTO "ArticleGame" ("articleId", "gameId")
SELECT "id", "gameId" FROM "Article" WHERE "gameId" IS NOT NULL;

-- Data: every Steam user gets a verified Steam LinkedAccount (User.steamId stays as is).
-- Ids are random UUIDs here (the app generates cuids); both are opaque text ids.
INSERT INTO "LinkedAccount" ("id", "userId", "platform", "externalId", "handle", "verifiedAt", "lastSyncAttemptAt", "lastSyncedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", 'steam', "steamId", "displayName", "createdAt", "lastSyncAttemptAt", "lastSyncedAt", "createdAt"
FROM "User" WHERE "steamId" IS NOT NULL;
