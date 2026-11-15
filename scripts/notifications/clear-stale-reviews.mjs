#!/usr/bin/env node
/**
 * One-off: mark read every unread "Mission Needs Review" (MISSION_SUBMITTED) notification whose
 * submission is no longer PENDING. Going forward the app clears them itself when a submission is
 * approved / rejected / released (app/lib/review-notifications.ts); this cleans up the backlog.
 * DRY RUN BY DEFAULT: it prints the plan and writes nothing without --apply.
 *
 * Matching: a row with metadata.completionId is matched to that completion. A legacy row
 * (metadata null) is matched by actorId (the submitter) + the quoted mission title in the message.
 * A row is stale only when its completion exists and is not PENDING; rows that match no completion,
 * or one that is still PENDING, are left alone. Rows are only marked read (readAt), never deleted.
 *
 * The same pass covers the other "needs action" types (app/lib/action-notifications.ts):
 *   - BOUNTY_SUBMITTED: stale when metadata.bountyId points at a bounty no longer SUBMITTED.
 *   - VOUCH_REQUEST: stale when the recipient already vouched for metadata.requesterMemberId
 *     (the recipient's member id is looked up from the sheet; unresolvable recipients are kept).
 *   - DISAVOW_VOTE_NEEDED: stale when its disavowal has no OPEN round, or the recipient already
 *     voted on it. Legacy rows without metadata are matched by their exact link /disavow/<id>;
 *     anything unrecognisable is kept.
 * Pass --only=missions|bounties|vouches|disavow to limit the pass.
 *
 * Do not run --apply against production without the go-ahead.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/notifications/clear-stale-reviews.mjs            # dry run
 *   DATABASE_URL=... node scripts/notifications/clear-stale-reviews.mjs --apply    # marks them read
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");

const { planStaleReviews } = await importApp("app/lib/review-notifications.ts");
const { planStaleBounties, planStaleVouchRequests, planStaleDisavowVotes, disavowalIdOf } = await importApp("app/lib/action-notifications.ts");
const { prisma } = await importApp("app/lib/db.ts");

const only = args.only ? String(args.only) : null;
const wants = (name) => !only || only === name;

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);

  const unread = (type, select) => prisma.notification.findMany({ where: { type, readAt: null }, select: { id: true, recipientId: true, metadata: true, ...select } });
  const sections = [];

  if (wants("missions")) {
    const [notifications, completions] = await Promise.all([
      unread("MISSION_SUBMITTED", { actorId: true, message: true }),
      prisma.missionCompletion.findMany({
        select: { id: true, discordId: true, status: true, mission: { select: { title: true } } },
      }),
    ]);
    const plan = planStaleReviews(notifications, completions);
    sections.push({ label: "MISSION_SUBMITTED", total: notifications.length, notifications, stale: plan.stale, kept: plan.pending, unmatched: plan.unmatched, keptWhy: "submission still PENDING" });
  }

  if (wants("bounties")) {
    const notifications = await unread("BOUNTY_SUBMITTED", {});
    const ids = [...new Set(notifications.map((n) => n.metadata?.bountyId).filter((x) => Number.isInteger(x)))];
    const bounties = ids.length ? await prisma.bounty.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : [];
    const plan = planStaleBounties(notifications, bounties);
    sections.push({ label: "BOUNTY_SUBMITTED", total: notifications.length, notifications, ...plan, keptWhy: "bounty still SUBMITTED" });
  }

  if (wants("vouches")) {
    const notifications = await unread("VOUCH_REQUEST", {});
    const { fetchMemberIdByDiscordId } = await importApp("app/lib/sheets/member-repository.ts");
    const memberIdByDiscordId = new Map();
    for (const d of new Set(notifications.map((n) => n.recipientId))) {
      try {
        const m = await fetchMemberIdByDiscordId(d);
        if (m) memberIdByDiscordId.set(d, String(m));
      } catch {
        /* unresolvable: its rows are kept */
      }
    }
    const requesters = [...new Set(notifications.map((n) => n.metadata?.requesterMemberId).filter(Boolean))];
    const vouches = requesters.length
      ? await prisma.vouch.findMany({ where: { followeeId: { in: requesters }, followerId: { in: [...memberIdByDiscordId.values()] } }, select: { followerId: true, followeeId: true } })
      : [];
    const plan = planStaleVouchRequests(notifications, memberIdByDiscordId, new Set(vouches.map((v) => `${v.followerId}>${v.followeeId}`)));
    sections.push({ label: "VOUCH_REQUEST", total: notifications.length, notifications, ...plan, keptWhy: "recipient has not vouched" });
  }

  if (wants("disavow")) {
    const notifications = await unread("DISAVOW_VOTE_NEEDED", { linkUrl: true });
    const ids = [...new Set(notifications.map((n) => disavowalIdOf(n)).filter(Boolean))];
    const found = ids.length
      ? await prisma.disavowal.findMany({
          where: { id: { in: ids } },
          select: { id: true, rounds: { where: { state: "OPEN" }, select: { votes: { select: { voterDiscordId: true } } } } },
        })
      : [];
    const disavowals = found.map((d) => ({ id: d.id, openRoundVoters: d.rounds.length ? d.rounds.flatMap((r) => r.votes.map((v) => v.voterDiscordId)) : null }));
    const plan = planStaleDisavowVotes(notifications, disavowals);
    sections.push({ label: "DISAVOW_VOTE_NEEDED", total: notifications.length, notifications, ...plan, keptWhy: "round still open, not voted yet" });
  }

  let allStale = [];
  for (const s of sections) {
    const stale = new Set(s.stale);
    const recipients = new Set(s.notifications.filter((n) => stale.has(n.id)).map((n) => n.recipientId));
    console.log(`\nUnread ${s.label} notifications: ${s.total}`);
    console.log(`  stale, would be marked read: ${s.stale.length} across ${recipients.size} recipients`);
    console.log(`  ${s.keptWhy} (kept): ${s.kept.length}`);
    console.log(`  no matching record (kept): ${s.unmatched.length}`);
    allStale = allStale.concat(s.stale);
  }

  if (!allStale.length) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to mark ${allStale.length} notifications read.`);
  } else {
    let done = 0;
    for (let i = 0; i < allStale.length; i += 500) {
      const r = await prisma.notification.updateMany({
        where: { id: { in: allStale.slice(i, i + 500) }, readAt: null },
        data: { readAt: new Date() },
      });
      done += r.count;
    }
    console.log(`\nApplied: ${done} notifications marked read.`);
  }
} finally {
  await prisma.$disconnect();
}
