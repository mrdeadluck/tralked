-- Additive: when the login e-mail was confirmed (null = not confirmed). Existing users start unconfirmed.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
