-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('FORM', 'APP', 'REVIEWER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('EVENT_BUDGET', 'REIMBURSEMENT', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECEIVED', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'PAID', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PaymentLane" AS ENUM ('FAST', 'STANDARD', 'HIGH_RISK', 'VOTE_REQUIRED');

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "sourceRef" TEXT,
    "kind" "PaymentKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECEIVED',
    "lane" "PaymentLane" NOT NULL DEFAULT 'STANDARD',
    "requesterDiscordId" TEXT,
    "claimedDiscordId" TEXT,
    "requesterMemberId" TEXT,
    "requesterLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "eventCity" TEXT,
    "rsvEventSlug" TEXT,
    "amountUsdCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountOriginal" DECIMAL(65,30),
    "payeeHash" TEXT,
    "payeeHint" TEXT,
    "proposalUrl" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMP(3),
    "approvalsNeeded" INTEGER NOT NULL DEFAULT 1,
    "rejectedAsFraud" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCheck" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "model" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDecision" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "actorIsDpr" BOOLEAN NOT NULL DEFAULT false,
    "lane" "PaymentLane" NOT NULL,
    "riskScoreAtAction" INTEGER NOT NULL,
    "flagsAtAction" JSONB NOT NULL,
    "checklist" JSONB,
    "note" TEXT,
    "proofRef" TEXT,
    "deployEnv" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_sourceRef_key" ON "PaymentRequest"("sourceRef");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_lane_createdAt_idx" ON "PaymentRequest"("status", "lane", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_requesterDiscordId_idx" ON "PaymentRequest"("requesterDiscordId");

-- CreateIndex
CREATE INDEX "PaymentRequest_claimedDiscordId_idx" ON "PaymentRequest"("claimedDiscordId");

-- CreateIndex
CREATE INDEX "PaymentRequest_payeeHash_idx" ON "PaymentRequest"("payeeHash");

-- CreateIndex
CREATE INDEX "PaymentAttachment_sha256_idx" ON "PaymentAttachment"("sha256");

-- CreateIndex
CREATE INDEX "PaymentAttachment_requestId_idx" ON "PaymentAttachment"("requestId");

-- CreateIndex
CREATE INDEX "PaymentCheck_requestId_createdAt_idx" ON "PaymentCheck"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCheck_kind_createdAt_idx" ON "PaymentCheck"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentDecision_requestId_createdAt_idx" ON "PaymentDecision"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentDecision_actorDiscordId_idx" ON "PaymentDecision"("actorDiscordId");

-- AddForeignKey
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCheck" ADD CONSTRAINT "PaymentCheck_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDecision" ADD CONSTRAINT "PaymentDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PaymentDecision is an append-only record: the database itself refuses to change or remove a row,
-- whatever code (or person) tries. Corrections are new rows.
CREATE OR REPLACE FUNCTION payment_decision_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PaymentDecision is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentDecision_no_update_delete"
BEFORE UPDATE OR DELETE ON "PaymentDecision"
FOR EACH ROW EXECUTE FUNCTION payment_decision_append_only();

CREATE TRIGGER "PaymentDecision_no_truncate"
BEFORE TRUNCATE ON "PaymentDecision"
FOR EACH STATEMENT EXECUTE FUNCTION payment_decision_append_only();
