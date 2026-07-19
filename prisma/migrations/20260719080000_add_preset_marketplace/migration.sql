-- CreateEnum
CREATE TYPE "PresetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PresetPurchaseStatus" AS ENUM ('PAID', 'REFUNDED');

-- CreateTable
CREATE TABLE "presets" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PresetStatus" NOT NULL DEFAULT 'DRAFT',
    "packageKey" TEXT,
    "packageName" TEXT,
    "packageSize" INTEGER,
    "previewUrl" TEXT,
    "coverUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_purchases" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PresetPurchaseStatus" NOT NULL DEFAULT 'PAID',
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "providerRef" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "preset_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presets_status_createdAt_idx" ON "presets"("status", "createdAt");
CREATE INDEX "presets_sellerId_updatedAt_idx" ON "presets"("sellerId", "updatedAt");
CREATE UNIQUE INDEX "preset_purchases_buyerId_presetId_key" ON "preset_purchases"("buyerId", "presetId");
CREATE INDEX "preset_purchases_presetId_status_idx" ON "preset_purchases"("presetId", "status");

-- AddForeignKey
ALTER TABLE "presets" ADD CONSTRAINT "presets_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "preset_purchases" ADD CONSTRAINT "preset_purchases_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "preset_purchases" ADD CONSTRAINT "preset_purchases_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
