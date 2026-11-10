-- AlterTable
ALTER TABLE "Member" ADD COLUMN "mergedInto" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MemberMerge" (
    "id" SERIAL NOT NULL,
    "keepId" TEXT NOT NULL,
    "removeId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Member_mergedInto_idx" ON "Member"("mergedInto");

-- CreateIndex
CREATE INDEX "MemberMerge_keepId_idx" ON "MemberMerge"("keepId");

-- CreateIndex
CREATE INDEX "MemberMerge_removeId_idx" ON "MemberMerge"("removeId");
