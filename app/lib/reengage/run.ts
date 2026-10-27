// app/lib/reengage/run.ts
//
// The weekly re-engagement run (called by /api/cron/reengage).
//
//  - Eligible: a member who entered an email in the app, verified it with the
//    signed confirmation link, and explicitly opted in
//    (MemberProfileExtras.email / emailVerifiedAt / reengageEmailOptIn). The
//    Crew sheet is public, so it is never read for addresses.
//  - Idempotent: a (memberId, weekKey) row is claimed BEFORE sending (unique
//    key, createMany skipDuplicates), so overlapping/retried cron runs never
//    double-send. A permanent failure keeps its row (no retry within the week);
//    a retryable one (429/5xx/timeout) releases it so a later run tries again.
//  - Fair: members are ordered least-recently-emailed first, and one address is
//    used at most once per run (case-insensitive), so the batch cap starves nobody.
//  - Gated: nothing is sent or written unless REENGAGE_EMAIL_ENABLED=true, the
//    run is not a dry run, and RESEND_API_KEY and REENGAGE_POSTAL_ADDRESS are set
//    (checked before any claim).
//
// Logs counts only, never addresses.
import { prisma } from "@/app/lib/db";
import { getSheetData } from "@/app/lib/sheets/member-repository";
import { SITE_URL } from "@/app/lib/site-url";
import { loadDigests, parseCrewNames, type DigestCandidate } from "./digest";
import { renderDigestEmail } from "./render";
import { sendEmail, postalAddress } from "./mailer";
import { unsubscribePageUrl, unsubscribePostUrl } from "./unsub-sig";

export const DEFAULT_BATCH = 60;
const MAX_BATCH = 300;

export const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

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

export interface Eligible extends DigestCandidate {
  email: string;
}

/**
 * Eligible members not yet handled this week, least-recently-emailed first, one
 * per address (before the batch limit).
 */
export async function listEligible(week: string): Promise<{ eligible: Eligible[]; optedIn: number; duplicates: number }> {
  const [sheet, optedInRows, sentRows, lastSent] = await Promise.all([
    getSheetData(),
    prisma.memberProfileExtras.findMany({
      where: { reengageEmailOptIn: true, emailVerifiedAt: { not: null }, email: { not: null } },
      select: { memberId: true, email: true },
    }),
    prisma.reengageEmailSend.findMany({ where: { weekKey: week }, select: { memberId: true } }),
    prisma.reengageEmailSend.groupBy({ by: ["memberId"], where: { status: "SENT" }, _max: { sentAt: true } }),
  ]);
  const done = new Set(sentRows.map((r) => r.memberId));
  const last = new Map(lastSent.map((r) => [r.memberId, r._max.sentAt?.getTime() ?? 0]));

  const pool: Eligible[] = [];
  for (const r of optedInRows) {
    const email = (r.email ?? "").trim();
    if (!EMAIL_RE.test(email) || done.has(r.memberId)) continue;
    const idx = sheet.memberToIdx.get(r.memberId);
    if (idx === undefined) continue;
    const row = sheet.rows[idx];
    pool.push({
      memberId: r.memberId,
      email,
      discordId: String(row.discordId ?? "").trim(),
      name: String(row["Name"] || row["Mafia Name"] || "").trim(),
      crewNames: parseCrewNames(row["Crews"]),
    });
  }
  pool.sort((a, b) => (last.get(a.memberId) ?? 0) - (last.get(b.memberId) ?? 0) || a.memberId.localeCompare(b.memberId));

  const seen = new Set<string>();
  const eligible: Eligible[] = [];
  let duplicates = 0;
  for (const e of pool) {
    const key = e.email.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    eligible.push(e);
  }
  return { eligible, optedIn: optedInRows.length, duplicates };
}

export interface ReengageResult {
  week: string;
  dryRun: boolean;
  enabled: boolean;
  optedIn: number;
  duplicates: number;
  eligible: number;
  /** Set when a real run was refused before claiming anything. */
  blocked?: "no_api_key" | "no_postal_address";
  /** Claims released after a retryable provider failure (429/5xx/timeout). */
  released: number;
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

  const { eligible, optedIn, duplicates } = await listEligible(week);
  const result: ReengageResult = {
    week, dryRun, enabled, optedIn, duplicates,
    eligible: eligible.length, batch: 0, skippedEmpty: 0, sent: 0, failed: 0, alreadyClaimed: 0, released: 0,
  };

  // Refuse before claiming anything if the mail could not go out compliantly.
  const postal = postalAddress();
  if (!dryRun) {
    if (!process.env.RESEND_API_KEY?.trim()) return { ...result, blocked: "no_api_key" };
    if (!postal) return { ...result, blocked: "no_postal_address" };
  }

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
    const rendered = renderDigestEmail(digest, { siteUrl: SITE_URL, unsubscribeUrl: page, postalAddress: postal });
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
    } else if (sent.retryable) {
      // Provider is throttling/down: free the claim so a later run retries.
      result.released++;
      await prisma.reengageEmailSend.deleteMany({
        where: { memberId: digest.memberId, weekKey: week, status: "SENDING" },
      });
      if (sent.rateLimited) break;
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
