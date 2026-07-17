-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "emailVerificationCode" TEXT;
ALTER TABLE "users" ADD COLUMN "emailVerificationExpires" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "vkId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX "users_vkId_key" ON "users"("vkId");

-- Existing password users are treated as already verified
UPDATE "users" SET "emailVerified" = true WHERE "password" IS NOT NULL;
