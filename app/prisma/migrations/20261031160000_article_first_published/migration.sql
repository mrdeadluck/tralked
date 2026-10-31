-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "firstPublishedAt" TIMESTAMP(3);

-- Backfill: articles that are (or were archived after being) live keep their URL.
UPDATE "Article" SET "firstPublishedAt" = "publishedAt" WHERE "status" IN ('published', 'archived');
