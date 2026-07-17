-- CreateTable
CREATE TABLE "midi_samples" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "midi_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "midi_samples_ownerId_idx" ON "midi_samples"("ownerId");

-- CreateIndex
CREATE INDEX "midi_samples_projectId_idx" ON "midi_samples"("projectId");

-- AddForeignKey
ALTER TABLE "midi_samples"
ADD CONSTRAINT "midi_samples_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "midi_samples"
ADD CONSTRAINT "midi_samples_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "midi_projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
