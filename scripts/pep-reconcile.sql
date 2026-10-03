-- scripts/pep-reconcile.sql
--
-- READ-ONLY reconciliation of the $PEP economy (Economy, Transaction, Bounty,
-- MissionCompletion, JobAssignment). Every statement is a SELECT; nothing is
-- written. Run it inside a read-only session so that is enforced by Postgres:
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$DATABASE_URL" -X -P pager=off -f scripts/pep-reconcile.sql
--
-- Each check returns one row per problem with columns
--   check_name, severity ('error' | 'warn' | 'info'), user_id, detail...
-- An empty result means the check passed. 'info' rows are expected history
-- (e.g. balances that predate the ledger, added 2026-02-07), not bugs.
--
-- Background: Economy.wallet is the source of truth for balances. Transaction
-- is an append-only ledger with a signed amount and the running balance after
-- the change. Balances that existed before the ledger was introduced show up
-- as an "opening balance" = (first.balance - first.amount).

-- 1. Wallet vs ledger, per user.
--    error: last ledger running balance != wallet (a change after the last
--           ledger row was not logged, or rows were logged out of order), or
--           wallet - SUM(amount) != implied opening balance (an unlogged
--           change somewhere in the history).
WITH firsts AS (
  SELECT DISTINCT ON ("userId") "userId", balance - amount AS opening
  FROM "Transaction" ORDER BY "userId", id ASC
), lasts AS (
  SELECT DISTINCT ON ("userId") "userId", balance AS last_balance, "createdAt" AS last_at
  FROM "Transaction"
  -- chainNeutral backfill rows (scripts/pep-fixes) sit outside the running-balance chain
  WHERE COALESCE(metadata->>'chainNeutral', 'false') <> 'true'
  ORDER BY "userId", id DESC
), sums AS (
  SELECT "userId", SUM(amount)::bigint AS ledger_sum, COUNT(*)::bigint AS tx_count
  FROM "Transaction" GROUP BY "userId"
)
SELECT 'wallet_vs_ledger' AS check_name, 'error' AS severity, e.id AS user_id,
       e.wallet, s.ledger_sum, f.opening AS implied_opening,
       e.wallet - s.ledger_sum AS wallet_minus_ledger,
       l.last_balance, l.last_at, s.tx_count
FROM "Economy" e
JOIN sums s ON s."userId" = e.id
JOIN firsts f ON f."userId" = e.id
JOIN lasts l ON l."userId" = e.id
WHERE l.last_balance <> e.wallet OR e.wallet - s.ledger_sum <> f.opening
ORDER BY ABS(e.wallet - s.ledger_sum - f.opening) DESC;

-- 2. Running-balance chain breaks: prev.balance + amount <> balance.
--    Points at the exact ledger row where an unlogged change (or an
--    out-of-transaction log) happened.
SELECT 'running_balance_chain' AS check_name, 'error' AS severity, "userId" AS user_id,
       id AS tx_id, type, amount, balance, prev_balance,
       balance - (prev_balance + amount) AS drift, "createdAt"
FROM (
  SELECT t.*, LAG(balance) OVER (PARTITION BY "userId" ORDER BY id) AS prev_balance
  FROM "Transaction" t
  WHERE COALESCE(t.metadata->>'chainNeutral', 'false') <> 'true'
) x
WHERE prev_balance IS NOT NULL AND prev_balance + amount <> balance
  -- a break that a chainNeutral backfill row explains (same tx, same amount) is resolved
  AND NOT EXISTS (
    SELECT 1 FROM "Transaction" b
    WHERE b."userId" = x."userId"
      AND b.metadata->>'chainNeutral' = 'true'
      AND (b.metadata->>'explainsTxId')::int = x.id
      AND b.amount = x.balance - (x.prev_balance + x.amount)
  )
ORDER BY "userId", id;

-- 3. Balances with no ledger at all (predate the ledger, or seeded by hand).
SELECT 'unledgered_balance' AS check_name, 'info' AS severity, e.id AS user_id, e.wallet, e."createdAt"
FROM "Economy" e
WHERE e.wallet <> 0 AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."userId" = e.id)
ORDER BY e.wallet DESC;

-- 4. Negative balances (wallet or any running balance).
SELECT 'negative_wallet' AS check_name, 'error' AS severity, id AS user_id, wallet, NULL::int AS tx_id
FROM "Economy" WHERE wallet < 0
UNION ALL
SELECT 'negative_running_balance', 'error', "userId", balance, id
FROM "Transaction" WHERE balance < 0;

-- 5. Orphan ledger rows: no Economy row for the user.
SELECT 'orphan_transaction' AS check_name, 'error' AS severity, t."userId" AS user_id,
       COUNT(*)::bigint AS tx_count, SUM(t.amount)::bigint AS amount_sum
FROM "Transaction" t
LEFT JOIN "Economy" e ON e.id = t."userId"
WHERE e.id IS NULL
GROUP BY t."userId";

-- 6. Ledger rows whose sign contradicts their type, or zero amounts.
SELECT 'amount_sign' AS check_name, 'error' AS severity, "userId" AS user_id, id AS tx_id, type, amount
FROM "Transaction"
WHERE amount = 0
   OR (type IN ('TRANSFER_SENT', 'SHOP_PURCHASE', 'BOUNTY_ESCROW', 'ROB_LOSS', 'GAME_BET', 'CRIME_FINE') AND amount > 0)
   OR (type IN ('TRANSFER_RECEIVED', 'JOB_REWARD', 'BOUNTY_REWARD', 'BOUNTY_REFUND', 'MISSION_REWARD',
                'ROLE_INCOME', 'ROB_STEAL', 'GAME_WIN', 'WORK_REWARD', 'CRIME_REWARD') AND amount < 0
       -- approved admin clawbacks (scripts/pep-fixes) reverse a reward type on purpose
       AND COALESCE(metadata->>'adjustment', '') <> 'clawback');

-- 7. Ledger rows pointing at a bounty / job / shop item that does not exist.
SELECT 'orphan_reference' AS check_name, 'warn' AS severity, t."userId" AS user_id, t.id AS tx_id, t.type, t.metadata
FROM "Transaction" t
WHERE (t.metadata ? 'bountyId' AND NOT EXISTS (SELECT 1 FROM "Bounty" b WHERE b.id = (t.metadata->>'bountyId')::int))
   OR (t.metadata ? 'jobId' AND NOT EXISTS (SELECT 1 FROM "Job" j WHERE j.id = (t.metadata->>'jobId')::int))
   OR (t.metadata ? 'itemId' AND NOT EXISTS (SELECT 1 FROM "ShopItem" s WHERE s.id = (t.metadata->>'itemId')::int));

-- 8. Duplicate bounty payouts / refunds, or both for the same bounty.
SELECT 'bounty_duplicate_release' AS check_name, 'error' AS severity,
       MIN(t."userId") AS user_id, (t.metadata->>'bountyId')::int AS bounty_id,
       COUNT(*) FILTER (WHERE t.type = 'BOUNTY_REWARD')::bigint AS rewards,
       COUNT(*) FILTER (WHERE t.type = 'BOUNTY_REFUND')::bigint AS refunds,
       COUNT(*) FILTER (WHERE t.type = 'BOUNTY_ESCROW')::bigint AS escrows,
       SUM(t.amount)::bigint AS net
FROM "Transaction" t
WHERE t.type IN ('BOUNTY_REWARD', 'BOUNTY_REFUND', 'BOUNTY_ESCROW') AND t.metadata ? 'bountyId'
GROUP BY (t.metadata->>'bountyId')::int
HAVING COUNT(*) FILTER (WHERE t.type IN ('BOUNTY_REWARD', 'BOUNTY_REFUND')) > 1
    OR COUNT(*) FILTER (WHERE t.type = 'BOUNTY_ESCROW') > 1;

-- 9. Bounty status vs ledger (ledger-era bounties, i.e. with an escrow row).
--    COMPLETED must have exactly one reward, CANCELLED exactly one refund,
--    OPEN/CLAIMED neither; escrow/reward/refund must equal Bounty.reward.
WITH b AS (
  SELECT bo.id, bo.status, bo.reward, bo."createdBy", bo."claimedBy",
    COUNT(t.*) FILTER (WHERE t.type = 'BOUNTY_ESCROW') AS escrows,
    COUNT(t.*) FILTER (WHERE t.type = 'BOUNTY_REWARD') AS rewards,
    COUNT(t.*) FILTER (WHERE t.type = 'BOUNTY_REFUND') AS refunds,
    COALESCE(SUM(-t.amount) FILTER (WHERE t.type = 'BOUNTY_ESCROW'), 0) AS escrowed,
    COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('BOUNTY_REWARD', 'BOUNTY_REFUND')), 0) AS released
  FROM "Bounty" bo
  LEFT JOIN "Transaction" t ON t.metadata ? 'bountyId' AND (t.metadata->>'bountyId')::int = bo.id
  GROUP BY bo.id
)
SELECT 'bounty_status_vs_ledger' AS check_name,
       CASE WHEN escrows = 0 THEN 'info' ELSE 'error' END AS severity,
       "createdBy" AS user_id, id AS bounty_id, status, reward, escrows, rewards, refunds, escrowed, released
FROM b
WHERE (escrows = 0 AND status IN ('COMPLETED', 'CANCELLED') AND rewards + refunds = 0) -- pre-ledger history
   OR (escrows > 0 AND (
        escrowed <> reward
     OR (status = 'COMPLETED' AND (rewards <> 1 OR refunds <> 0 OR released <> reward))
     OR (status = 'CANCELLED' AND (refunds <> 1 OR rewards <> 0 OR released <> reward))
     OR (status IN ('OPEN', 'CLAIMED') AND rewards + refunds > 0)))
ORDER BY severity, id;

-- 10. Mission level reward paid more than once per (user, level).
SELECT 'mission_reward_duplicate' AS check_name, 'error' AS severity, "userId" AS user_id, lvl AS level,
       COUNT(*)::bigint AS payouts, SUM(amount)::bigint AS total_paid, MIN("createdAt") AS first_at, MAX("createdAt") AS last_at
FROM (
  SELECT t.*, COALESCE((t.metadata->>'level')::int, substring(t.description FROM 'Level ([0-9]+)')::int) AS lvl
  FROM "Transaction" t WHERE t.type = 'MISSION_REWARD'
) m
GROUP BY "userId", lvl
HAVING COUNT(*) > 1;

-- 11. Mission level rewards paid without every active mission of that level
--     approved (warn: missions may have been added to the level later).
WITH paid AS (
  SELECT DISTINCT "userId",
         COALESCE((metadata->>'level')::int, substring(description FROM 'Level ([0-9]+)')::int) AS level
  FROM "Transaction" WHERE type = 'MISSION_REWARD'
)
SELECT 'mission_reward_without_completion' AS check_name, 'warn' AS severity, p."userId" AS user_id, p.level,
       COUNT(m.id)::bigint AS active_missions,
       COUNT(mc.id)::bigint AS approved
FROM paid p
JOIN "Mission" m ON m.level = p.level AND m."isActive"
LEFT JOIN "MissionCompletion" mc ON mc."missionId" = m.id AND mc."discordId" = p."userId" AND mc.status = 'APPROVED'
GROUP BY p."userId", p.level
HAVING COUNT(mc.id) < COUNT(m.id);

-- 12. Daily job paid more than once per (user, job, UTC day).
--     Downgraded to 'info' once an admin clawback row exists for the user
--     (scripts/pep-fixes), since the history stays but the excess is reversed.
SELECT 'daily_job_duplicate' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM "Transaction" c
         WHERE c."userId" = "Transaction"."userId" AND c.metadata->>'adjustment' = 'clawback'
       ) THEN 'info (clawed back)' ELSE 'error' END AS severity,
       "userId" AS user_id,
       (metadata->>'jobId')::int AS job_id, ("createdAt" AT TIME ZONE 'UTC')::date AS utc_day,
       COUNT(*)::bigint AS payouts, SUM(amount)::bigint AS total_paid
FROM "Transaction"
WHERE type = 'JOB_REWARD' AND description LIKE 'Daily job:%'
GROUP BY "userId", (metadata->>'jobId')::int, ("createdAt" AT TIME ZONE 'UTC')::date
HAVING COUNT(*) > 1;

-- 13. Transfers: TRANSFER_SENT and TRANSFER_RECEIVED rows must pair up
--     per (sender, recipient, amount) (both sides are written in one DB transaction).
WITH sent AS (
  SELECT "userId" AS from_id, metadata->>'toUserId' AS to_id, -amount AS amt, COUNT(*) AS n
  FROM "Transaction" WHERE type = 'TRANSFER_SENT' GROUP BY 1, 2, 3
), recv AS (
  SELECT metadata->>'fromUserId' AS from_id, "userId" AS to_id, amount AS amt, COUNT(*) AS n
  FROM "Transaction" WHERE type = 'TRANSFER_RECEIVED' GROUP BY 1, 2, 3
)
SELECT 'transfer_unmatched' AS check_name, 'error' AS severity,
       COALESCE(s.from_id, r.from_id) AS user_id, COALESCE(s.to_id, r.to_id) AS to_user_id,
       COALESCE(s.amt, r.amt) AS amount, COALESCE(s.n, 0)::bigint AS sent_rows, COALESCE(r.n, 0)::bigint AS received_rows
FROM sent s
FULL OUTER JOIN recv r ON r.from_id = s.from_id AND r.to_id = s.to_id AND r.amt = s.amt
WHERE COALESCE(s.n, 0) <> COALESCE(r.n, 0);

-- 13b. Blackjack: a hand pays out at most once, the payout matches the
--      settled row, and a live (ACTIVE) hand has paid nothing yet.
WITH wins AS (
  SELECT metadata->>'gameId' AS game_id, COUNT(*)::bigint AS n, SUM(amount)::bigint AS paid
  FROM "Transaction" WHERE type = 'GAME_WIN' AND metadata->>'game' = 'blackjack' GROUP BY 1
)
SELECT 'blackjack_payout' AS check_name, 'error' AS severity, g."discordId" AS user_id, g.id AS game_id,
       g.status::text AS status, g.payout, COALESCE(w.n, 0) AS win_rows, COALESCE(w.paid, 0) AS paid
FROM "BlackjackGame" g
LEFT JOIN wins w ON w.game_id = g.id
WHERE COALESCE(w.n, 0) > 1
   OR (g.status = 'ACTIVE' AND COALESCE(w.n, 0) > 0)
   OR (g.status = 'SETTLED' AND COALESCE(w.paid, 0) <> COALESCE(g.payout, 0));

-- 14. Supply summary (one row). With the ledger as the record of flows:
--       held      = SUM(wallet) + PEP escrowed in open/claimed bounties
--       minted    = JOB_REWARD + MISSION_REWARD             (new PEP)
--       burned    = -SHOP_PURCHASE                          (PEP leaves circulation)
--       opening   = SUM(wallet) - SUM(all ledger amounts)   (pre-ledger balances)
--     Invariant: held = opening + minted - burned + (escrow_in_bounty_table - escrow_in_ledger)
--     and transfers_net = 0. escrow_in_bounty_table vs escrow_in_ledger differ
--     only by bounties escrowed before the ledger existed.
SELECT 'summary' AS check_name, 'info' AS severity,
  (SELECT COUNT(*) FROM "Economy")::bigint                                   AS wallets,
  (SELECT COALESCE(SUM(wallet), 0) FROM "Economy")::bigint                   AS sum_wallets,
  (SELECT COALESCE(SUM(reward), 0) FROM "Bounty" WHERE status IN ('OPEN', 'CLAIMED'))::bigint AS escrow_in_bounty_table,
  (SELECT COALESCE(-SUM(amount), 0) FROM "Transaction" WHERE type IN ('BOUNTY_ESCROW', 'BOUNTY_REWARD', 'BOUNTY_REFUND'))::bigint AS escrow_in_ledger,
  (SELECT COALESCE(SUM(amount), 0) FROM "Transaction" WHERE type IN ('JOB_REWARD', 'MISSION_REWARD'))::bigint AS minted,
  (SELECT COALESCE(SUM(amount), 0) FROM "Transaction" WHERE type = 'JOB_REWARD')::bigint     AS minted_jobs,
  (SELECT COALESCE(SUM(amount), 0) FROM "Transaction" WHERE type = 'MISSION_REWARD')::bigint AS minted_missions,
  (SELECT COALESCE(-SUM(amount), 0) FROM "Transaction" WHERE type = 'SHOP_PURCHASE')::bigint AS burned_shop,
  (SELECT COALESCE(SUM(amount), 0) FROM "Transaction" WHERE type IN ('TRANSFER_SENT', 'TRANSFER_RECEIVED'))::bigint AS transfers_net,
  (SELECT COALESCE(SUM(wallet), 0) FROM "Economy")::bigint
    - (SELECT COALESCE(SUM(amount), 0) FROM "Transaction")::bigint           AS opening_unledgered,
  (SELECT COUNT(*) FROM "Transaction")::bigint                                AS ledger_rows,
  (SELECT MIN("createdAt") FROM "Transaction")                                AS ledger_since;

-- 15. Ledger totals by type (one row per type).
SELECT 'totals_by_type' AS check_name, 'info' AS severity, type::text AS tx_type,
       COUNT(*)::bigint AS rows, SUM(amount)::bigint AS amount_sum,
       MIN("createdAt") AS first_at, MAX("createdAt") AS last_at
FROM "Transaction" GROUP BY type ORDER BY type;

-- 16. Wallets whose id is not a Discord snowflake (17-20 digits). Before the
--     recipient fix, sending to a member number or a typo auto-created such a
--     wallet; any balance there is stranded (nobody can log in as it).
SELECT 'non_discord_wallet' AS check_name, 'warn' AS severity, e.id AS user_id, e.wallet, e."createdAt",
       (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = e.id)::bigint AS tx_count
FROM "Economy" e
WHERE e.id !~ '^[0-9]{17,20}$' AND e.wallet <> 0
ORDER BY e.wallet DESC;
