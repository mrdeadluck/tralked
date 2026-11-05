-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "consoles" TEXT[] DEFAULT ARRAY[]::TEXT[];
