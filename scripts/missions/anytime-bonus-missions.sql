-- Anytime (level 0) bonus missions. Admin-only, NOT applied by any migration: review, then run once
-- against production AFTER migration 20261113000000_bonus_missions is applied
-- (e.g. with the pizzadao-db command, inside a transaction).
--
-- Idempotent: each row is inserted only if (level, index) is free (Mission has @@unique([level, index])),
-- and re-running changes nothing. bonusReward is set here directly and bonusRewardSetAt = now(), so
-- only approvals from then on are paid; later changes go through /admin/missions (Bonus reward field).
-- Mission.reward stays 0: level 0 has no level reward, only bonusReward.
--
-- Verifier keys: gpp_host and social_post are semi-automatic (the member submits a proof URL and a
-- reviewer approves); the rest are automatic (nightly run / "Check my progress").

INSERT INTO "Mission" ("level","index","title","description","reward","isActive","bonus","bonusReward","bonusRewardSetAt","verifierKey","verifierParams","proofKind")
SELECT v."level", v."index", v."title", v."description", 0, true, true, v."bonusReward", now(), v."verifierKey", v."verifierParams"::jsonb, v."proofKind"::"ProofKind"
FROM (VALUES
  (0, 0, 'Host a Global Pizza Party', 'Host a Global Pizza Party and submit its rsv.pizza event link. A reviewer confirms you hosted it.', 500, 'gpp_host', '{"eventType":"gpp","statuses":["approved","listed"]}', 'URL'),
  (0, 1, 'Pizzeria check-in', 'Check in at a pizzeria from your Passport page.', 50, 'pizzeria_checkin', '{"min":1}', 'NONE'),
  (0, 2, 'Passport collector', 'Collect 5 stamps in your Passport by checking in at pizzerias.', 150, 'passport_stamps', '{"min":5}', 'NONE'),
  (0, 3, 'Get featured in the Spotlight', 'Get featured in the PizzaDAO Spotlight.', 300, 'spotlight', '{"min":1}', 'NONE'),
  (0, 4, 'Merch buyer', 'Buy an item from the shop.', 100, 'shop_purchase', '{"min":1}', 'NONE'),
  (0, 5, 'Call streak', 'Join 10 Community Calls within 30 days.', 200, 'attendance_count', '{"min":10,"windowDays":30,"crewId":"community_call"}', 'NONE'),
  (0, 6, 'Bounty hunter', 'Complete a bounty, or do 10 jobs.', 250, 'bounty_or_job', '{"min":1,"minJobs":10}', 'NONE'),
  (0, 7, 'Link another account', 'Link your Telegram or Farcaster account on your profile.', 50, 'social_linked', '{"platforms":["telegram","farcaster"]}', 'NONE'),
  (0, 8, 'Writer', 'Publish an article.', 250, 'article_published', '{"min":1}', 'NONE'),
  (0, 9, 'Comms ambassador', 'Post about PizzaDAO (tag PizzaDAO) on X or Farcaster and get 25+ likes, then submit the link to your post. A reviewer checks the numbers.', 250, 'social_post', '{"minReplies":0,"minLikes":25,"platforms":["x","farcaster"]}', 'URL')
) AS v("level","index","title","description","bonusReward","verifierKey","verifierParams","proofKind")
WHERE NOT EXISTS (SELECT 1 FROM "Mission" m WHERE m."level" = v."level" AND m."index" = v."index");
