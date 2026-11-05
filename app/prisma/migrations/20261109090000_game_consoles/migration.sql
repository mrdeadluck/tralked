-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "consoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Game_consoles_idx" ON "Game" USING GIN ("consoles");
