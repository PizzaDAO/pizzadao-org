// app/lib/reengage/run.ts
//
// The weekly re-engagement run (called by /api/cron/reengage).
//
//  - Eligible: a members-sheet row with a valid email, not opted out
//    (MemberProfileExtras.reengageEmailOptOut), with nothing recorded yet for
//    this ISO week in ReengageEmailSend.
//  - Idempotent: a (memberId, weekKey) row is claimed BEFORE sending (unique
//    key, createMany skipDuplicates), so overlapping/retried cron runs never
//    double-send. A failed or interrupted send keeps its row (no retry within
//    the week) so one bad address can't eat every batch.
//  - Batch-limited: at most `limit` sends per run; the cron fires several
//    times on its day and each run takes the next members in sheet order.
//  - Gated: nothing is sent or written unless REENGAGE_EMAIL_ENABLED=true and
//    the run is not a dry run. Dry runs only count what would be sent.
//
// Logs counts only, never addresses.
import { prisma } from "@/app/lib/db";
import { getSheetData, type MemberSheetData } from "@/app/lib/sheets/member-repository";
import { SITE_URL } from "@/app/lib/site-url";
import { loadDigests, parseCrewNames, type DigestCandidate } from "./digest";
import { renderDigestEmail } from "./render";
import { sendEmail } from "./mailer";
import { unsubscribePageUrl, unsubscribePostUrl } from "./unsub-sig";

export const DEFAULT_BATCH = 60;
const MAX_BATCH = 300;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function reengageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REENGAGE_EMAIL_ENABLED?.trim().toLowerCase() === "true";
}

/** ISO 8601 week key in UTC, e.g. "2026-W44". */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The email cell of a member row (header "Email"/"E-mail", any case), or null if absent/invalid. */
export function memberEmail(row: MemberSheetData): string | null {
  for (const [k, v] of Object.entries(row)) {
    if (!/^e-?mail( address)?$/i.test(k.trim())) continue;
    const s = String(v ?? "").trim();
    return EMAIL_RE.test(s) ? s : null;
  }
  return null;
}

function rowMemberId(row: MemberSheetData): string {
  for (const k of ["ID", "Id", "id", "Member ID", "MemberID", "CrewID", "Crew ID"]) {
    const v = row[k];
    if (v !== undefined && String(v).trim()) return String(v).trim();
  }
  return "";
}

function rowName(row: MemberSheetData): string {
  return String(row["Name"] || row["Mafia Name"] || "").trim();
}

export interface Eligible extends DigestCandidate {
  email: string;
}

/** Eligible members not yet handled this week, in sheet order (before the batch limit). */
export async function listEligible(week: string): Promise<{ eligible: Eligible[]; withEmail: number; optedOut: number }> {
  const [sheet, optedOutRows, sentRows] = await Promise.all([
    getSheetData(),
    prisma.memberProfileExtras.findMany({ where: { reengageEmailOptOut: true }, select: { memberId: true } }),
    prisma.reengageEmailSend.findMany({ where: { weekKey: week }, select: { memberId: true } }),
  ]);
  const optedOut = new Set(optedOutRows.map((r) => r.memberId));
  const done = new Set(sentRows.map((r) => r.memberId));

  const eligible: Eligible[] = [];
  let withEmail = 0;
  for (const row of sheet.rows) {
    const memberId = rowMemberId(row);
    const email = memberEmail(row);
    if (!memberId || !email) continue;
    withEmail++;
    if (optedOut.has(memberId) || done.has(memberId)) continue;
    eligible.push({
      memberId,
      email,
      discordId: String(row.discordId ?? "").trim(),
      name: rowName(row),
      crewNames: parseCrewNames(row["Crews"]),
    });
  }
  return { eligible, withEmail, optedOut: optedOut.size };
}

export interface ReengageResult {
  week: string;
  dryRun: boolean;
  enabled: boolean;
  withEmail: number;
  optedOut: number;
  eligible: number;
  /** Members in this batch whose digest had something to say. */
  batch: number;
  skippedEmpty: number;
  sent: number;
  failed: number;
  alreadyClaimed: number;
}

export interface ReengageOptions {
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}

export function clampBatch(limit: number | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const raw = limit ?? Number(env.REENGAGE_BATCH_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BATCH;
  return Math.min(Math.floor(raw), MAX_BATCH);
}

export async function runReengage(opts: ReengageOptions = {}): Promise<ReengageResult> {
  const now = opts.now ?? new Date();
  const week = weekKey(now);
  const enabled = reengageEnabled();
  const dryRun = opts.dryRun === true || !enabled;
  const limit = clampBatch(opts.limit);

  const { eligible, withEmail, optedOut } = await listEligible(week);
  const result: ReengageResult = {
    week, dryRun, enabled, withEmail, optedOut,
    eligible: eligible.length, batch: 0, skippedEmpty: 0, sent: 0, failed: 0, alreadyClaimed: 0,
  };

  const batch = eligible.slice(0, limit);
  const digests = await loadDigests(batch, now);
  const byId = new Map(batch.map((b) => [b.memberId, b]));

  for (const digest of digests) {
    if (!digest.hasContent) {
      result.skippedEmpty++;
      // Record it so an empty digest doesn't hold a place at the front of every batch.
      if (!dryRun) {
        await prisma.reengageEmailSend.createMany({
          data: [{ memberId: digest.memberId, weekKey: week, status: "SKIPPED", locale: digest.locale }],
          skipDuplicates: true,
        });
      }
      continue;
    }
    result.batch++;
    if (dryRun) continue;
    // Never send mail that can't be unsubscribed from (no SESSION_SECRET to sign the link).
    if (!unsubscribePostUrl(digest.memberId)) {
      result.failed++;
      continue;
    }

    const claim = await prisma.reengageEmailSend.createMany({
      data: [{ memberId: digest.memberId, weekKey: week, status: "SENDING", locale: digest.locale }],
      skipDuplicates: true,
    });
    if (claim.count !== 1) {
      result.alreadyClaimed++;
      continue;
    }

    const email = byId.get(digest.memberId)!.email;
    const page = unsubscribePageUrl(digest.memberId);
    const post = unsubscribePostUrl(digest.memberId);
    const rendered = renderDigestEmail(digest, { siteUrl: SITE_URL, unsubscribeUrl: page });
    const sent = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `reengage-${digest.memberId}-${week}`,
      headers: post
        ? { "List-Unsubscribe": `<${post}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined,
    });
    if (sent.ok) {
      result.sent++;
      await prisma.reengageEmailSend.updateMany({
        where: { memberId: digest.memberId, weekKey: week },
        data: { status: "SENT", sentAt: new Date() },
      });
    } else {
      result.failed++;
      await prisma.reengageEmailSend.updateMany({
        where: { memberId: digest.memberId, weekKey: week },
        data: { status: "FAILED" },
      });
    }
  }
  return result;
}
