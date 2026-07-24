-- CreateEnum
CREATE TYPE "CommentVoteType" AS ENUM ('LIKE', 'DISLIKE');

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN "likes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "post_comments" ADD COLUMN "dislikes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN "likes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "comments" ADD COLUMN "dislikes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "post_comment_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "type" "CommentVoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comment_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "type" "CommentVoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_comment_votes_commentId_type_idx" ON "post_comment_votes"("commentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "post_comment_votes_userId_commentId_key" ON "post_comment_votes"("userId", "commentId");

-- CreateIndex
CREATE INDEX "comment_votes_commentId_type_idx" ON "comment_votes"("commentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "comment_votes_userId_commentId_key" ON "comment_votes"("userId", "commentId");

-- AddForeignKey
ALTER TABLE "post_comment_votes" ADD CONSTRAINT "post_comment_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment_votes" ADD CONSTRAINT "post_comment_votes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_votes" ADD CONSTRAINT "comment_votes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
