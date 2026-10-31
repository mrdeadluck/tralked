-- AlterTable
ALTER TABLE "GuideStep" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GuideStep_guideId_key_key" ON "GuideStep"("guideId", "key");

