-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "repostedSoundToksPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sound_toks" ADD COLUMN IF NOT EXISTS "views" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sound_toks" ADD COLUMN IF NOT EXISTS "repostsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "sound_tok_reposts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "soundTokId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sound_tok_reposts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sound_tok_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "soundTokId" TEXT NOT NULL,
    "guestKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sound_tok_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sound_tok_reposts_userId_soundTokId_key" ON "sound_tok_reposts"("userId", "soundTokId");
CREATE INDEX IF NOT EXISTS "sound_tok_reposts_userId_createdAt_idx" ON "sound_tok_reposts"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "sound_tok_reposts_soundTokId_idx" ON "sound_tok_reposts"("soundTokId");

CREATE UNIQUE INDEX IF NOT EXISTS "sound_tok_views_userId_soundTokId_key" ON "sound_tok_views"("userId", "soundTokId");
CREATE UNIQUE INDEX IF NOT EXISTS "sound_tok_views_guestKey_soundTokId_key" ON "sound_tok_views"("guestKey", "soundTokId");
CREATE INDEX IF NOT EXISTS "sound_tok_views_soundTokId_idx" ON "sound_tok_views"("soundTokId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "sound_tok_reposts" ADD CONSTRAINT "sound_tok_reposts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sound_tok_reposts" ADD CONSTRAINT "sound_tok_reposts_soundTokId_fkey" FOREIGN KEY ("soundTokId") REFERENCES "sound_toks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sound_tok_views" ADD CONSTRAINT "sound_tok_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sound_tok_views" ADD CONSTRAINT "sound_tok_views_soundTokId_fkey" FOREIGN KEY ("soundTokId") REFERENCES "sound_toks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
