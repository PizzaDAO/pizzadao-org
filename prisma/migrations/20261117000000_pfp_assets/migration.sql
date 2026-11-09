-- CreateTable
CREATE TABLE "PfpAsset" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "defaultTransform" JSONB,
    "lockedHint" VARCHAR(120),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PfpAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PfpAssetRule" (
    "id" SERIAL NOT NULL,
    "assetId" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "params" JSONB NOT NULL,

    CONSTRAINT "PfpAssetRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PfpAssetGrant" (
    "assetId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PfpAssetGrant_pkey" PRIMARY KEY ("assetId","discordId")
);

-- CreateTable
CREATE TABLE "MemberPfp" (
    "memberId" TEXT NOT NULL,
    "baseKind" VARCHAR(16) NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "layers" JSONB NOT NULL,
    "composedUrl" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPfp_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "PfpAdminEvent" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "assetId" INTEGER,
    "assetName" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PfpAdminEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PfpAsset_slug_key" ON "PfpAsset"("slug");

-- CreateIndex
CREATE INDEX "PfpAssetRule_assetId_idx" ON "PfpAssetRule"("assetId");

-- CreateIndex
CREATE INDEX "PfpAssetGrant_discordId_idx" ON "PfpAssetGrant"("discordId");

-- CreateIndex
CREATE INDEX "PfpAdminEvent_createdAt_idx" ON "PfpAdminEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PfpAdminEvent_assetId_createdAt_idx" ON "PfpAdminEvent"("assetId", "createdAt");

-- AddForeignKey
ALTER TABLE "PfpAssetRule" ADD CONSTRAINT "PfpAssetRule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "PfpAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PfpAssetGrant" ADD CONSTRAINT "PfpAssetGrant_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "PfpAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

