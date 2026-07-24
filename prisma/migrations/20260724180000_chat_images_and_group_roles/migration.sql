-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ChatMemberRole" AS ENUM ('MEMBER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "avatar" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "chat_users" ADD COLUMN IF NOT EXISTS "role" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_users_chatId_role_idx" ON "chat_users"("chatId", "role");

-- Backfill: group creators become admins
UPDATE "chat_users" AS cu
SET "role" = 'ADMIN'
FROM "chats" AS c
WHERE cu."chatId" = c."id"
  AND c."type" = 'GROUP'
  AND c."creatorId" IS NOT NULL
  AND cu."userId" = c."creatorId";
