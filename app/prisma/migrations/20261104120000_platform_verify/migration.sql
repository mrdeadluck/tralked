-- "Verificar agora" for active connections (lib/accounts/verify.ts): the last ownership check of
-- the platform profile (cooldown) and why it failed. Nullable columns without defaults: a
-- metadata-only change, no table rewrite, nothing existing changes meaning.
ALTER TABLE "LinkedAccount" ADD COLUMN "verifyCheckedAt" TIMESTAMP(3),
ADD COLUMN "verifyFailure" TEXT;
