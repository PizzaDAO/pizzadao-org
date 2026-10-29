-- Mission.guideHref: the handbook page that explains how to do a mission (plans/onboarding-guide.md, PR 3).
--
-- Additive and nullable, so it is safe to apply before the code that uses it is deployed. No data
-- changes: the per-mission links are filled by scripts/missions/set-guide-links.mjs (dry run by
-- default), run separately after review. Guarded, so a re-run is harmless.
-- NOT applied to any database by this commit.
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "guideHref" VARCHAR(120);
