-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('WAITING', 'INVITING', 'SELECTING_BEAT', 'USER1_TURN', 'USER2_TURN', 'JUDGING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BattleParticipantRole" AS ENUM ('CREATOR', 'OPPONENT', 'JUDGE');

-- CreateEnum
CREATE TYPE "BattleWinner" AS ENUM ('USER1', 'USER2', 'DRAW');

-- CreateTable
CREATE TABLE "battles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "BattleStatus" NOT NULL DEFAULT 'WAITING',
    "creatorId" TEXT NOT NULL,
    "beatUrl" TEXT,
    "beatName" TEXT,
    "winner" "BattleWinner",
    "judgedBy" TEXT,
    "judgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_participants" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BattleParticipantRole" NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_recordings" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceUrl" TEXT NOT NULL,
    "beatUrl" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "recordingQuality" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_judges" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "judgeType" TEXT NOT NULL DEFAULT 'ai',
    "user1Flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user1Lyrics" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user1Delivery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user2Flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user2Lyrics" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user2Delivery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user1Total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user2Total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feedback" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_judges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "battle_participants_battleId_userId_role_key" ON "battle_participants"("battleId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "battle_judges_battleId_key" ON "battle_judges"("battleId");

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_recordings" ADD CONSTRAINT "battle_recordings_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_recordings" ADD CONSTRAINT "battle_recordings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
