-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "battleElo" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "battleWins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "battleLosses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "battleDraws" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "battles" ADD COLUMN IF NOT EXISTS "eloApplied" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "battle_queue_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "elo" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Ranked Battle',
    "beatUrl" TEXT,
    "beatName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "battle_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "battle_queue_entries_userId_key" ON "battle_queue_entries"("userId");
CREATE INDEX IF NOT EXISTS "battle_queue_entries_elo_joinedAt_idx" ON "battle_queue_entries"("elo", "joinedAt");

ALTER TABLE "battle_queue_entries" DROP CONSTRAINT IF EXISTS "battle_queue_entries_userId_fkey";
ALTER TABLE "battle_queue_entries" ADD CONSTRAINT "battle_queue_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
