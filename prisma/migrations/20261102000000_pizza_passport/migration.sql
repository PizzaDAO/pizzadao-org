-- CreateEnum
CREATE TYPE "PizzeriaSource" AS ENUM ('OVERTURE', 'OSM', 'MEMBER', 'ADMIN', 'GPP');

-- CreateEnum
CREATE TYPE "PizzeriaStatus" AS ENUM ('ACTIVE', 'PENDING', 'HIDDEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('GEO', 'QR', 'QR_NO_GEO', 'ADMIN');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- AlterTable
ALTER TABLE "MemberProfileExtras" ADD COLUMN     "passportVisibility" VARCHAR(8) NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "Pizzeria" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(120),
    "countryCode" VARCHAR(2),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "source" "PizzeriaSource" NOT NULL,
    "sourceId" TEXT,
    "isChain" BOOLEAN NOT NULL DEFAULT false,
    "status" "PizzeriaStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPartner" BOOLEAN NOT NULL DEFAULT false,
    "partnerSince" TIMESTAMP(3),
    "qrVersion" INTEGER NOT NULL DEFAULT 1,
    "logoUrl" TEXT,
    "logoConsentAt" TIMESTAMP(3),
    "stampInk" VARCHAR(16),
    "website" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pizzeria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzeriaCheckIn" (
    "id" SERIAL NOT NULL,
    "pizzeriaId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "method" "CheckInMethod" NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'APPROVED',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" INTEGER,
    "distanceM" INTEGER,
    "riskFlags" JSONB,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PizzeriaCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportStamp" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "pizzeriaId" TEXT NOT NULL,
    "firstCheckInId" INTEGER NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "lastVisitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "stampedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PassportStamp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pizzeria_slug_key" ON "Pizzeria"("slug");

-- CreateIndex
CREATE INDEX "Pizzeria_lat_lng_idx" ON "Pizzeria"("lat", "lng");

-- CreateIndex
CREATE INDEX "Pizzeria_countryCode_city_idx" ON "Pizzeria"("countryCode", "city");

-- CreateIndex
CREATE INDEX "Pizzeria_isPartner_idx" ON "Pizzeria"("isPartner");

-- CreateIndex
CREATE UNIQUE INDEX "Pizzeria_source_sourceId_key" ON "Pizzeria"("source", "sourceId");

-- CreateIndex
CREATE INDEX "PizzeriaCheckIn_discordId_createdAt_idx" ON "PizzeriaCheckIn"("discordId", "createdAt");

-- CreateIndex
CREATE INDEX "PizzeriaCheckIn_pizzeriaId_createdAt_idx" ON "PizzeriaCheckIn"("pizzeriaId", "createdAt");

-- CreateIndex
CREATE INDEX "PizzeriaCheckIn_status_idx" ON "PizzeriaCheckIn"("status");

-- CreateIndex
CREATE INDEX "PassportStamp_discordId_stampedAt_idx" ON "PassportStamp"("discordId", "stampedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PassportStamp_discordId_pizzeriaId_key" ON "PassportStamp"("discordId", "pizzeriaId");

-- AddForeignKey
ALTER TABLE "PizzeriaCheckIn" ADD CONSTRAINT "PizzeriaCheckIn_pizzeriaId_fkey" FOREIGN KEY ("pizzeriaId") REFERENCES "Pizzeria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportStamp" ADD CONSTRAINT "PassportStamp_pizzeriaId_fkey" FOREIGN KEY ("pizzeriaId") REFERENCES "Pizzeria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

