-- One-off $PEP data cleanup, 2026-10-03 (approved by Snax).
--
-- Findings from scripts/pep-reconcile.sql + manual review against completed
-- missions:
--   1. Discord 1385650393710727301 was paid the same 3 daily jobs 81 times on
--      2026-02-23 (4,050 PEP; should have been 150). Claw back 3,900.
--   2. Five members were paid mission level rewards correctly, but the ledger
--      row was never written (pre-#133 bug). Backfill the missing rows. No
--      balance changes.
--   3. 120 PEP sits in wallets keyed by Member ID ("42", "446", "494") instead
--      of a Discord ID (pre-#133 send-form bug). Move it to those members.
--
-- Safety: everything runs in ONE transaction. Each step first asserts the exact
-- state that was reviewed (wallets / last ledger balance) and RAISEs, which
-- rolls everything back, if anything differs. Re-running after success fails
-- on those same guards, so it can't apply twice.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pep-fixes/2026-10-03-cleanup.sql
-- Then re-run scripts/pep-reconcile.sql to confirm.

BEGIN;

DO $$
DECLARE
  w INT;
  last_bal INT;
  v_dst TEXT;
  v_src TEXT;
  v_amt INT;
  pair RECORD;
BEGIN
  ------------------------------------------------------------------------
  -- 1. Claw back the 2026-02-23 daily-job exploit.
  ------------------------------------------------------------------------
  SELECT wallet INTO w FROM "Economy" WHERE id = '1385650393710727301' FOR UPDATE;
  SELECT balance INTO last_bal FROM "Transaction" WHERE "userId" = '1385650393710727301' ORDER BY id DESC LIMIT 1;
  IF w IS DISTINCT FROM 9425 OR last_bal IS DISTINCT FROM 9425 THEN
    RAISE EXCEPTION 'step 1 guard: expected wallet/last balance 9425 for 1385650393710727301, got %/%', w, last_bal;
  END IF;
  UPDATE "Economy" SET wallet = wallet - 3900, "updatedAt" = now() WHERE id = '1385650393710727301';
  INSERT INTO "Transaction" ("userId", type, amount, balance, description, metadata)
  VALUES ('1385650393710727301', 'JOB_REWARD', -3900, 5525,
          'Clawback: 2026-02-23 daily-job exploit (81 payouts for 3 jobs; 150 legit)',
          '{"adjustment":"clawback","reason":"daily-job exploit 2026-02-23","approvedBy":"snax","date":"2026-10-03"}');

  ------------------------------------------------------------------------
  -- 2a. Backfill missing mission-reward rows where the gap is at the END of the
  --     ledger (last ledger balance + amount = wallet). Normal chain rows.
  ------------------------------------------------------------------------
  FOR pair IN SELECT * FROM (VALUES
      ('360610446786560020', 2, 420, 69, 489),
      ('315214793378234368', 2, 420, 69, 489),
      ('831906222088650773', 5, 4269, 5067, 9336)
    ) AS t(uid, lvl, amt, expect_last, expect_wallet)
  LOOP
    SELECT wallet INTO w FROM "Economy" WHERE id = pair.uid FOR UPDATE;
    SELECT balance INTO last_bal FROM "Transaction" WHERE "userId" = pair.uid ORDER BY id DESC LIMIT 1;
    IF w IS DISTINCT FROM pair.expect_wallet OR last_bal IS DISTINCT FROM pair.expect_last THEN
      RAISE EXCEPTION 'step 2a guard for %: expected wallet % / last %, got % / %',
        pair.uid, pair.expect_wallet, pair.expect_last, w, last_bal;
    END IF;
    INSERT INTO "Transaction" ("userId", type, amount, balance, description, metadata)
    VALUES (pair.uid, 'MISSION_REWARD', pair.amt, pair.expect_last + pair.amt,
            'Mission reward: Level ' || pair.lvl || ' (backfilled ledger entry; paid earlier, not logged)',
            json_build_object('level', pair.lvl, 'backfill', true, 'date', '2026-10-03'));
  END LOOP;

  ------------------------------------------------------------------------
  -- 2b. Backfill missing mission-reward rows whose amount is ALREADY inside a
  --     later row's running balance (a mid-history chain break). These rows are
  --     "chainNeutral": they count toward the ledger sum but are skipped by the
  --     running-balance checks. explainsTxId points at the broken row.
  ------------------------------------------------------------------------
  FOR pair IN SELECT * FROM (VALUES
      ('831906222088650773', 4, 3141, 310),
      ('812144514583232534', 3, 1337, 288),
      ('740763030626762872', 2, 420, 152)
    ) AS t(uid, lvl, amt, tx)
  LOOP
    PERFORM 1 FROM "Transaction" cur
      WHERE cur.id = pair.tx AND cur."userId" = pair.uid
        AND cur.balance - cur.amount - (
          SELECT p.balance FROM "Transaction" p
          WHERE p."userId" = pair.uid AND p.id < pair.tx ORDER BY p.id DESC LIMIT 1
        ) = pair.amt;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'step 2b guard: tx % for % does not show a % drift', pair.tx, pair.uid, pair.amt;
    END IF;
    SELECT wallet INTO w FROM "Economy" WHERE id = pair.uid;
    INSERT INTO "Transaction" ("userId", type, amount, balance, description, metadata)
    VALUES (pair.uid, 'MISSION_REWARD', pair.amt, w,
            'Mission reward: Level ' || pair.lvl || ' (backfilled ledger entry; already included in balance)',
            json_build_object('level', pair.lvl, 'backfill', true, 'chainNeutral', true,
                              'explainsTxId', pair.tx, 'date', '2026-10-03'));
  END LOOP;

  ------------------------------------------------------------------------
  -- 3. Move PEP stranded in Member-ID wallets to the right Discord wallets.
  --    If the member has no wallet yet but has a User row, create the wallet.
  --    If they have no User row (never logged in), hold it as a pending claim.
  ------------------------------------------------------------------------
  FOR pair IN SELECT * FROM (VALUES
      ('42',  '403065718914154516',  69),
      ('446', '1506999257021026435', 1),
      ('494', '1108830606990790676', 50)
    ) AS t(src, dst, amt)
  LOOP
    v_src := pair.src; v_dst := pair.dst; v_amt := pair.amt;
    SELECT wallet INTO w FROM "Economy" WHERE id = v_src FOR UPDATE;
    IF w IS DISTINCT FROM v_amt THEN
      RAISE EXCEPTION 'step 3 guard: wallet % expected %, got %', v_src, v_amt, w;
    END IF;

    UPDATE "Economy" SET wallet = 0, "updatedAt" = now() WHERE id = v_src;
    INSERT INTO "Transaction" ("userId", type, amount, balance, description, metadata)
    VALUES (v_src, 'TRANSFER_SENT', -v_amt, 0,
            'Moved stranded PEP to member ' || v_src || ' (Discord ' || v_dst || ')',
            json_build_object('toUserId', v_dst, 'adjustment', 'stranded-member-id-wallet', 'date', '2026-10-03'));

    IF NOT EXISTS (SELECT 1 FROM "Economy" WHERE id = v_dst)
       AND EXISTS (SELECT 1 FROM "User" WHERE id = v_dst) THEN
      INSERT INTO "Economy" (id, wallet, "createdAt", "updatedAt") VALUES (v_dst, 0, now(), now());
    END IF;

    IF EXISTS (SELECT 1 FROM "Economy" WHERE id = v_dst) THEN
      SELECT wallet INTO w FROM "Economy" WHERE id = v_dst FOR UPDATE;
      UPDATE "Economy" SET wallet = wallet + v_amt, "updatedAt" = now() WHERE id = v_dst;
      INSERT INTO "Transaction" ("userId", type, amount, balance, description, metadata)
      VALUES (v_dst, 'TRANSFER_RECEIVED', v_amt, w + v_amt,
              'Recovered PEP sent to your Member ID (' || v_src || ')',
              json_build_object('fromUserId', v_src, 'adjustment', 'stranded-member-id-wallet', 'date', '2026-10-03'));
      RAISE NOTICE 'moved % PEP from % to wallet %', v_amt, v_src, v_dst;
    ELSE
      INSERT INTO "PendingPepClaim" ("migrationKey", source, "discordId", amount, "sourceCash", "sourceBank", "snapshotSha", "updatedAt")
      VALUES ('stranded-member-id:' || v_src || ':' || v_dst, 'stranded-member-id', v_dst, v_amt, 0, 0, 'n/a', now());
      RAISE NOTICE 'held % PEP from % as a pending claim for % (no account yet)', v_amt, v_src, v_dst;
    END IF;
  END LOOP;
END $$;

COMMIT;
