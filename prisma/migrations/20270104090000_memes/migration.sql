-- Meme folder (bellpepper-80127): uploaded memes and member reports.
-- Purely additive: two new tables, nothing existing changes.

-- CreateTable
CREATE TABLE "Meme" (
    "id" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "caption" VARCHAR(200),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "privatePath" TEXT,
    "publicUrl" TEXT,
    "mime" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" VARCHAR(64) NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(300),
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemeReport" (
    "memeId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemeReport_pkey" PRIMARY KEY ("memeId","reporterId")
);

-- CreateIndex
CREATE INDEX "Meme_status_createdAt_idx" ON "Meme"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Meme_uploaderId_createdAt_idx" ON "Meme"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "Meme_sha256_idx" ON "Meme"("sha256");

-- CreateIndex
CREATE INDEX "MemeReport_reporterId_createdAt_idx" ON "MemeReport"("reporterId", "createdAt");
