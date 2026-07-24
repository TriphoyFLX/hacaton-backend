-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'REPOST';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
