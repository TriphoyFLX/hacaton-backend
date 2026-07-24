-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likedSoundToksPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "likes_userId_createdAt_idx" ON "likes"("userId", "createdAt");
