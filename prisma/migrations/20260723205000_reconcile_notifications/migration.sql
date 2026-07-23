-- Replace the legacy notification table, which used recipientId/title/message,
-- with the event-based shape consumed by the current application.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'userId'
  ) THEN
    DROP TABLE "notifications" CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('LIKE', 'COMMENT', 'FOLLOW', 'MESSAGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_userId_readAt_createdAt_idx"
  ON "notifications"("userId", "readAt", "createdAt");

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_userId_fkey";
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_actorId_fkey";
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
