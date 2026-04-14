-- CreateTable
CREATE TABLE "CallAttendance" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT,
    "crewId" TEXT NOT NULL,
    "crewLabel" TEXT NOT NULL,
    "callDate" TIMESTAMP(3) NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSyncLog" (
    "id" SERIAL NOT NULL,
    "crewSheetId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "dailySheetId" TEXT NOT NULL,
    "callDate" TIMESTAMP(3) NOT NULL,
    "attendeeCount" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallAttendance_discordId_dailySheetId_key" ON "CallAttendance"("discordId", "dailySheetId");

-- CreateIndex
CREATE INDEX "CallAttendance_discordId_idx" ON "CallAttendance"("discordId");

-- CreateIndex
CREATE INDEX "CallAttendance_crewId_idx" ON "CallAttendance"("crewId");

-- CreateIndex
CREATE INDEX "CallAttendance_callDate_idx" ON "CallAttendance"("callDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSyncLog_dailySheetId_key" ON "AttendanceSyncLog"("dailySheetId");
