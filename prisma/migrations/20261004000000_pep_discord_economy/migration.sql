-- UnbelievaBoat replacement, part 2 (plans/unbelievaboat-replacement.md):
-- /collect-income, /rob, casino games (blackjack/roulette/slots), and manual
-- grants of UnbelievaBoat item holdings.
--
-- Additive only: six new TransactionType values, one new enum, three new tables.
-- Depends on 20261003000000_pep_migration_and_earning (EconomyCooldown and the
-- WORK/CRIME/MIGRATION enum values) being applied first.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`
-- against a throwaway local Postgres 17 built from origin/main's schema with
-- `prisma db push` (replaying the full migration history fails on a fresh DB
-- because some production tables predate the migrations folder). It was then
-- applied to that DB and re-diffed clean. It has NOT been applied to Neon:
-- run `npx prisma migrate deploy` on a Neon branch first, then production,
-- BEFORE deploying the code that uses it.

-- CreateEnum
CREATE TYPE "BlackjackStatus" AS ENUM ('ACTIVE', 'SETTLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'ROLE_INCOME';
ALTER TYPE "TransactionType" ADD VALUE 'ROB_STEAL';
ALTER TYPE "TransactionType" ADD VALUE 'ROB_LOSS';
ALTER TYPE "TransactionType" ADD VALUE 'ROB_FINE';
ALTER TYPE "TransactionType" ADD VALUE 'GAME_BET';
ALTER TYPE "TransactionType" ADD VALUE 'GAME_WIN';

-- CreateTable
CREATE TABLE "EconomyPeaceMode" (
    "discordId" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyPeaceMode_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "BlackjackGame" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "activeKey" TEXT,
    "source" TEXT NOT NULL,
    "bet" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" "BlackjackStatus" NOT NULL DEFAULT 'ACTIVE',
    "outcome" TEXT,
    "payout" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BlackjackGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemGrant" (
    "id" SERIAL NOT NULL,
    "grantKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlackjackGame_activeKey_key" ON "BlackjackGame"("activeKey");

-- CreateIndex
CREATE INDEX "BlackjackGame_status_expiresAt_idx" ON "BlackjackGame"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BlackjackGame_discordId_createdAt_idx" ON "BlackjackGame"("discordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGrant_grantKey_key" ON "ItemGrant"("grantKey");

-- CreateIndex
CREATE INDEX "ItemGrant_discordId_idx" ON "ItemGrant"("discordId");

