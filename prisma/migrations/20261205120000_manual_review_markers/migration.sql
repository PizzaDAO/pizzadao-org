-- Additive: review markers on the manuals index. Existing rows keep NULL (never reviewed / not replaced).

-- AlterTable
ALTER TABLE "Manual"
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "supersededBy" TEXT;
