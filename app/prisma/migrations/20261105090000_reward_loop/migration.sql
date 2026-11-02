-- Reward loop: the highscores "Esta semana" board sums each player's XP of the last 7 days.
-- Additive: an index only (new notification kinds need no schema change: kind is free text).
CREATE INDEX "XpLedgerEntry_createdAt_idx" ON "XpLedgerEntry"("createdAt");
