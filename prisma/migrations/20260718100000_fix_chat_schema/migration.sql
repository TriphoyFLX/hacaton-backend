-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('DIRECT', 'GROUP');

-- AlterTable chats
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "type" "ChatType" NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "creatorId" TEXT;

-- AlterTable messages
ALTER TABLE "messages" ALTER COLUMN "receiverId" DROP NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "soundTokId" TEXT;

-- AlterTable chat_users
ALTER TABLE "chat_users" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "chat_users" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);

-- Foreign keys (ignore if already exist)
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_soundTokId_fkey"
    FOREIGN KEY ("soundTokId") REFERENCES "sound_toks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
