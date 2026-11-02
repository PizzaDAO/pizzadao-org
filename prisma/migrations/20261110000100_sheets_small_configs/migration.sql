-- Google Sheets cutover, small configs (plans/sheets-cutover.md, PR 1): POAP whitelist, NFT
-- collections, manuals index. ADDITIVE ONLY (three new tables, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "PoapWhitelistEntry" (
  "eventId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "PoapWhitelistEntry_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE IF NOT EXISTS "NftCollection" (
  "id" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "addressKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "NftCollection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NftCollection_chain_addressKey_key" ON "NftCollection"("chain", "addressKey");

CREATE TABLE IF NOT EXISTS "Manual" (
  "id" TEXT NOT NULL,
  "titleKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "crew" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "authorId" TEXT NOT NULL DEFAULT '',
  "author" TEXT NOT NULL DEFAULT '',
  "lastUpdated" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "Manual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Manual_titleKey_key" ON "Manual"("titleKey");
