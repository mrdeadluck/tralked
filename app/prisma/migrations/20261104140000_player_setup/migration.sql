-- Player setup on the profile (item 19): owned platforms and an optional PC spec sheet.
-- Additive only: a new table, one small row per user who fills the setup (no rows are created
-- here), removed with the user by the cascade. No change to existing tables.
-- CreateTable
CREATE TABLE "PlayerSetup" (
    "userId" TEXT NOT NULL,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pc" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSetup_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "PlayerSetup" ADD CONSTRAINT "PlayerSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
