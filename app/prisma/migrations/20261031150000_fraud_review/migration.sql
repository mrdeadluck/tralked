-- AlterTable
ALTER TABLE "UserAchievement" ADD COLUMN     "fraudReview" TEXT,
ADD COLUMN     "fraudReviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UserAchievement_suspicious_fraudReview_idx" ON "UserAchievement"("suspicious", "fraudReview");

