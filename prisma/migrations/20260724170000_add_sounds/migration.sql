-- CreateTable
CREATE TABLE "sounds" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "authorId" TEXT NOT NULL,
    "originalSoundTokId" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sound_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "soundId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sound_favorites_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "sound_toks" ADD COLUMN "soundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sounds_originalSoundTokId_key" ON "sounds"("originalSoundTokId");

-- CreateIndex
CREATE INDEX "sounds_authorId_createdAt_idx" ON "sounds"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "sounds_useCount_createdAt_idx" ON "sounds"("useCount", "createdAt");

-- CreateIndex
CREATE INDEX "sound_favorites_userId_createdAt_idx" ON "sound_favorites"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "sound_favorites_soundId_idx" ON "sound_favorites"("soundId");

-- CreateIndex
CREATE UNIQUE INDEX "sound_favorites_userId_soundId_key" ON "sound_favorites"("userId", "soundId");

-- CreateIndex
CREATE INDEX "sound_toks_soundId_createdAt_idx" ON "sound_toks"("soundId", "createdAt");

-- AddForeignKey
ALTER TABLE "sounds" ADD CONSTRAINT "sounds_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sounds" ADD CONSTRAINT "sounds_originalSoundTokId_fkey" FOREIGN KEY ("originalSoundTokId") REFERENCES "sound_toks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sound_favorites" ADD CONSTRAINT "sound_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sound_favorites" ADD CONSTRAINT "sound_favorites_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "sounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sound_toks" ADD CONSTRAINT "sound_toks_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "sounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
