-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "lastSyncAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSyncAttemptAt" TIMESTAMP(3);
