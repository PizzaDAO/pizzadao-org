-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('TRANSFER_SENT', 'TRANSFER_RECEIVED', 'SHOP_PURCHASE', 'JOB_REWARD', 'BOUNTY_ESCROW', 'BOUNTY_REWARD', 'BOUNTY_REFUND');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");
