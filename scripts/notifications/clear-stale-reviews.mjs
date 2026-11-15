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
const { prisma } = await importApp("app/lib/db.ts");

try {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  console.log(`Database host: ${host}`);

  const [notifications, completions] = await Promise.all([
    prisma.notification.findMany({
      where: { type: "MISSION_SUBMITTED", readAt: null },
      select: { id: true, actorId: true, message: true, metadata: true, recipientId: true },
    }),
    prisma.missionCompletion.findMany({
      select: { id: true, discordId: true, status: true, mission: { select: { title: true } } },
    }),
  ]);

  const plan = planStaleReviews(notifications, completions);
  const stale = new Set(plan.stale);
  const recipients = new Set(notifications.filter((n) => stale.has(n.id)).map((n) => n.recipientId));
  console.log(`\nUnread MISSION_SUBMITTED notifications: ${notifications.length}`);
  console.log(`  stale (submission no longer PENDING), would be marked read: ${plan.stale.length} across ${recipients.size} reviewers`);
  console.log(`  submission still PENDING (kept): ${plan.pending.length}`);
  console.log(`  no matching submission (kept): ${plan.unmatched.length}`);

  if (!plan.stale.length) {
    console.log("\nNothing to do.");
  } else if (!args.apply) {
    console.log(`\nDRY RUN - nothing was written. Re-run with --apply to mark ${plan.stale.length} notifications read.`);
  } else {
    let done = 0;
    for (let i = 0; i < plan.stale.length; i += 500) {
      const r = await prisma.notification.updateMany({
        where: { id: { in: plan.stale.slice(i, i + 500) }, readAt: null },
        data: { readAt: new Date() },
      });
      done += r.count;
    }
    console.log(`\nApplied: ${done} notifications marked read.`);
  }
} finally {
  await prisma.$disconnect();
}
