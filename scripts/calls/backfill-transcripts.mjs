#!/usr/bin/env node
/**
 * Call transcript backfill (call-recap). DRY RUN BY DEFAULT: writes nothing and calls no API.
 *
 * Lists recordings from the last N days (default 14) that still have no spoken transcript, i.e. what
 * the /api/cron/call-transcripts job would pick up. With --apply it transcribes each one from its
 * per-speaker tracks (OpenAI) and regenerates the AI summary, exactly like the cron, one recording
 * at a time, oldest first. Published and rejected calls are never touched. It never posts to Discord
 * (recaps only go out when an admin publishes).
 *
 * Usage:
 *   node scripts/calls/backfill-transcripts.mjs                    # dry run
 *   node scripts/calls/backfill-transcripts.mjs --days 14 --limit 20
 *   node scripts/calls/backfill-transcripts.mjs --apply            # transcribe + summarize
 *
 * Re-transcribe ONE recording that already has a machine transcript (dry run unless --apply):
 *   node scripts/calls/backfill-transcripts.mjs --retranscribe <id>            # show what would be reset
 *   node scripts/calls/backfill-transcripts.mjs --retranscribe <id> --apply    # reset, then transcribe + summarize now
 *   node scripts/calls/backfill-transcripts.mjs --retranscribe <id> --apply --reset-only   # reset only; the cron redoes it within 15 min
 * Refuses a row with a reviewer-edited summary, a reviewer id, redacted lines or speakers, or status
 * PUBLISHED / REJECTED. Typed chat lines are kept; spoken lines are replaced.
 *
 * Needs (from a vercel env pull kept OUTSIDE the repo): DATABASE_URL, and for --apply OPENAI_API_KEY,
 * R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and the AI Gateway credentials
 * the summary uses (AI_GATEWAY_API_KEY, since there is no Vercel OIDC locally).
 * The 20261029000000_call_recap migration must be applied first.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ensureTsRuntime, importApp } from "../unbelievaboat/run-ts.mjs";
import { parseArgs, die, loadDotenv } from "../unbelievaboat/args.mjs";

ensureTsRuntime(import.meta.url);
loadDotenv(createRequire(import.meta.url));

const args = parseArgs(process.argv.slice(2), { booleans: ["apply", "help", "reset-only"] });
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");
const posInt = (v, name, fallback) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) die(`--${name} must be a positive integer`);
  return n;
};
const days = posInt(args.days, "days", 14);
const limit = posInt(args.limit, "limit", 50);
const apply = !!args.apply;

const { listPendingTranscription, transcribeRecording } = await importApp("app/lib/calls/transcribe.ts");
const { prisma } = await importApp("app/lib/db.ts");

if (args.retranscribe !== undefined) {
  const id = args.retranscribe;
  if (typeof id !== "string" || !id) die("--retranscribe needs a recording id");
  const { resetForRetranscribe } = await importApp("app/lib/calls/retranscribe.ts");
  try {
    console.log(apply ? "Mode: APPLY (resets, then re-transcribes)" : "Mode: DRY RUN (writes nothing)");
    if (apply && !args["reset-only"]) {
      for (const name of ["OPENAI_API_KEY", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) {
        if (!process.env[name]?.trim()) die(`--apply needs ${name} in the environment (or add --reset-only)`);
      }
    }
    const res = await resetForRetranscribe(id, { apply });
    if (!res.ok) die(`${id}: ${res.reason}${res.details.length ? ` (${res.details.join("; ")})` : ""}`);
    console.log(`${id}: ${res.speechLines} spoken line(s) ${apply ? "removed" : "would be removed"}, ${res.chatLines} chat line(s) kept`);
    if (!apply) {
      console.log("Re-run with --apply to reset and re-transcribe.");
    } else if (args["reset-only"]) {
      console.log("Reset done. The cron picks it up within 15 minutes.");
    } else {
      const outcome = await transcribeRecording(id, { log: (m) => console.warn("  ", m) });
      console.log(`${id}: ${outcome}`);
    }
  } finally {
    await prisma.$disconnect?.();
  }
  process.exit(0);
}

try {
  console.log(apply ? "Mode: APPLY (transcribes and summarizes)" : "Mode: DRY RUN (writes nothing)");
  if (apply) {
    for (const name of ["OPENAI_API_KEY", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) {
      if (!process.env[name]?.trim()) die(`--apply needs ${name} in the environment`);
    }
  }
  const pending = await listPendingTranscription(days, limit);
  console.log(`${pending.length} recording(s) from the last ${days} day(s) without a spoken transcript:`);
  for (const r of pending) {
    console.log(`  ${r.id}  ${r.startedAt.toISOString()}  ${Math.round(r.durationSec / 60)} min  ${r.status}  ${r.crewLabel ?? "(no crew)"}  ${r.eventName ?? ""}`);
  }
  if (apply) {
    for (const r of pending) {
      const outcome = await transcribeRecording(r.id, { log: (m) => console.warn("  ", m) });
      console.log(`  ${r.id}: ${outcome}`);
    }
  } else if (pending.length) {
    console.log("Re-run with --apply to transcribe them.");
  }
} finally {
  await prisma.$disconnect?.();
}
