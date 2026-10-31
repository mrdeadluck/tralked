-- Exophase-style connections: typing a profile links it at once. "linkedAt" marks an active
-- connection (syncs, pays XP); "verifiedAt" keeps meaning "ownership proven with a code".
-- Additive: existing verified rows stay verified and keep syncing.
ALTER TABLE "LinkedAccount" ADD COLUMN "linkedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Every row that holds a real platform id is an active connection (verified rows, and Steam rows
-- imported unverified, which already synced through User.steamId). Placeholder rows (unlinked
-- accounts, codes waiting for confirmation) are not.
UPDATE "LinkedAccount" SET "linkedAt" = COALESCE("verifiedAt", "createdAt") WHERE "externalId" NOT LIKE 'pending:%';
UPDATE "LinkedAccount" SET "linkedAt" = NULL WHERE "externalId" LIKE 'pending:%';

-- An active row holds a real id, an inactive one the placeholder; a proven account is active.
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_active_has_real_id"
  CHECK (("linkedAt" IS NULL) = ("externalId" LIKE 'pending:%'));
ALTER TABLE "LinkedAccount" ADD CONSTRAINT "LinkedAccount_verified_is_active"
  CHECK ("verifiedAt" IS NULL OR "linkedAt" IS NOT NULL);
