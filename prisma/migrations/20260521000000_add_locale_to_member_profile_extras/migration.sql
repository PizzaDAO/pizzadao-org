-- Additive: add `locale` column to MemberProfileExtras. Defaults to 'en' so
-- existing rows (created by the tagline editor) get the right value with no
-- backfill needed.
ALTER TABLE "MemberProfileExtras"
ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
