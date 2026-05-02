-- AlterTable
ALTER TABLE "sound_toks" ADD COLUMN     "commentsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "soundTokId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_soundTokId_fkey" FOREIGN KEY ("soundTokId") REFERENCES "sound_toks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
