-- CreateTable
CREATE TABLE "midi_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "midi_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "midi_projects_ownerId_updatedAt_idx"
ON "midi_projects"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "midi_projects"
ADD CONSTRAINT "midi_projects_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
