-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "requiredRoleId" TEXT NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchSignedAt" TIMESTAMP(3),

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingSignature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "blindedSig" TEXT NOT NULL,

    CONSTRAINT "PendingSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollResult" (
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "tally" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollResult_pkey" PRIMARY KEY ("pollId","optionId")
);

-- CreateTable
CREATE TABLE "ConsumedToken" (
    "tokenHash" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingSignature_userId_pollId_key" ON "PendingSignature"("userId", "pollId");

-- AddForeignKey
ALTER TABLE "PendingSignature" ADD CONSTRAINT "PendingSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingSignature" ADD CONSTRAINT "PendingSignature_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResult" ADD CONSTRAINT "PollResult_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
