-- UnbelievaBoat -> $PEP migration (plans/unbelievaboat-replacement.md).
-- Additive only: two new TransactionType values, one new enum, one new table.
-- Generated with `prisma migrate diff` against a throwaway local Postgres
-- seeded from origin/main's schema; never run against production by the
-- author. Apply with `npx prisma migrate deploy` before using the import
-- script or enabling PEP_MIGRATION_CLAIMS.

-- CreateEnum
CREATE TYPE "PepClaimStatus" AS ENUM ('PENDING', 'CREDITED', 'REVERSED', 'VOID');

-- AlterEnum (Postgres 12+ allows several ADD VALUE in one migration; Neon is 15+)
ALTER TYPE "TransactionType" ADD VALUE 'MIGRATION_CREDIT';
ALTER TYPE "TransactionType" ADD VALUE 'MIGRATION_REVERSAL';

-- CreateTable
CREATE TABLE "PendingPepClaim" (
    "id" SERIAL NOT NULL,
    "migrationKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceCash" BIGINT NOT NULL,
    "sourceBank" BIGINT NOT NULL,
    "snapshotSha" TEXT NOT NULL,
    "status" "PepClaimStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId" INTEGER,
    "creditedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingPepClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingPepClaim_migrationKey_key" ON "PendingPepClaim"("migrationKey");

-- CreateIndex
CREATE INDEX "PendingPepClaim_discordId_status_idx" ON "PendingPepClaim"("discordId", "status");

-- CreateIndex
CREATE INDEX "PendingPepClaim_source_status_idx" ON "PendingPepClaim"("source", "status");
