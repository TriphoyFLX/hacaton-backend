-- Preserve previous usernames so profile links and discovery keep working after rename.
CREATE TABLE IF NOT EXISTS "username_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "username_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "username_history_username_key" ON "username_history"("username");
CREATE INDEX IF NOT EXISTS "username_history_userId_idx" ON "username_history"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'username_history_userId_fkey'
  ) THEN
    ALTER TABLE "username_history"
      ADD CONSTRAINT "username_history_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
