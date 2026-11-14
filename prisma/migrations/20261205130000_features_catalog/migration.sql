-- Additive: public features catalog. New tables only; nothing existing is touched.

-- CreateTable
CREATE TABLE "FeatureApp" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "repo" TEXT,
    "repoPrivate" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT,
    "license" TEXT,
    "licenseNote" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'app',
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "FeatureApp_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "FeatureEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "audiences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'live',
    "access" TEXT NOT NULL DEFAULT 'public',
    "toggleKey" TEXT,
    "liveUrl" TEXT,
    "docsUrl" TEXT,
    "screenshotUrl" TEXT,
    "code" JSONB NOT NULL DEFAULT '[]',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "showWhenOff" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "linkCheck" JSONB,
    "linkCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "FeatureEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureApp_position_idx" ON "FeatureApp"("position");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureEntry_slug_key" ON "FeatureEntry"("slug");

-- CreateIndex
CREATE INDEX "FeatureEntry_appSlug_idx" ON "FeatureEntry"("appSlug");

-- CreateIndex
CREATE INDEX "FeatureEntry_published_position_idx" ON "FeatureEntry"("published", "position");

-- AddForeignKey
ALTER TABLE "FeatureEntry" ADD CONSTRAINT "FeatureEntry_appSlug_fkey" FOREIGN KEY ("appSlug") REFERENCES "FeatureApp"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
