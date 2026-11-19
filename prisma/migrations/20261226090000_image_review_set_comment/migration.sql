-- Overall (whole-set) feedback for the image review. Purely additive: one new table.

-- CreateTable
CREATE TABLE "ImageReviewSetComment" (
    "setId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageReviewSetComment_pkey" PRIMARY KEY ("setId","discordId")
);

-- AddForeignKey
ALTER TABLE "ImageReviewSetComment" ADD CONSTRAINT "ImageReviewSetComment_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ImageReviewSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
