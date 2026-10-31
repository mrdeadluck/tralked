-- Plano 4 (F5): "Não mostrar a animação nos próximos jogos" (sealed-case intro off on every device).
-- Additive and safe on a live database: a new column with a default.
ALTER TABLE "User" ADD COLUMN "caseIntroOff" BOOLEAN NOT NULL DEFAULT false;
