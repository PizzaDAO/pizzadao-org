-- Default PFP dough balls: one unique image per member without a PFP. Purely additive: two new tables.

-- CreateTable
CREATE TABLE "DefaultPfpAssignment" (
    "memberId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultPfpAssignment_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "DefaultPfpGeneration" (
    "id" SERIAL NOT NULL,
    "candidateId" TEXT,
    "status" VARCHAR(16) NOT NULL,
    "costCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultPfpGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DefaultPfpAssignment_candidateId_key" ON "DefaultPfpAssignment"("candidateId");

-- CreateIndex
CREATE INDEX "DefaultPfpGeneration_createdAt_idx" ON "DefaultPfpGeneration"("createdAt");

-- AddForeignKey
ALTER TABLE "DefaultPfpAssignment" ADD CONSTRAINT "DefaultPfpAssignment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ImageReviewCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
