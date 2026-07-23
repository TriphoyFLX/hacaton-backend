-- Performance indexes for feed, soundtok, payments and media lookups
CREATE INDEX IF NOT EXISTS "posts_authorId_createdAt_idx" ON "posts"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "posts_createdAt_idx" ON "posts"("createdAt");
CREATE INDEX IF NOT EXISTS "posts_likes_commentsCount_createdAt_idx" ON "posts"("likes", "commentsCount", "createdAt");
CREATE INDEX IF NOT EXISTS "media_postId_idx" ON "media"("postId");
CREATE INDEX IF NOT EXISTS "sound_toks_authorId_createdAt_idx" ON "sound_toks"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "sound_toks_createdAt_idx" ON "sound_toks"("createdAt");
CREATE INDEX IF NOT EXISTS "comments_soundTokId_createdAt_idx" ON "comments"("soundTokId", "createdAt");
CREATE INDEX IF NOT EXISTS "likes_soundTokId_idx" ON "likes"("soundTokId");
CREATE INDEX IF NOT EXISTS "payments_status_kind_idx" ON "payments"("status", "kind");
CREATE INDEX IF NOT EXISTS "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
