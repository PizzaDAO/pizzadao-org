// app/lib/trivia/reports.ts
//
// "This question is bad" reports (plans/done/trivia.md section 18): the flag reaction, replies to a question post and
// /trivia report all end up here as a TriviaReport row. Reports are never answer attempts. A question reported by
// REPORT_PULL_MEMBERS different members within REPORT_WINDOW_DAYS is pulled automatically (added to the
// trivia.disabledQuestionIds setting) and nothing is said publicly. The same setting is the admin's one-click disable.
import { prisma } from "@/app/lib/db";
import { Prisma } from "@prisma/client";
import { clearSettingsCache, loadSettings } from "@/app/lib/settings";
import { getQuestion } from "./bank";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { accountOldEnough, FLAG_REACTION, REQUIRE_MEMBER } from "./config";
import { parseSetting } from "@/app/lib/settings/registry";

export const REPORT_WINDOW_DAYS = 7;
export const REPORT_PULL_MEMBERS = 3;
export const AUTOPULL_ACTOR = "system:trivia-autopull";
const DAY_MS = 24 * 60 * 60 * 1000;
const SETTING = "trivia.disabledQuestionIds" as const;


/** The report words. The recorder keeps a copy (recorder/src/trivia-forward.ts); a parity test keeps the two equal. */
export const REPORT_WORDS = ["bad", "wrong", "broken", "report", "flag", "incorrect", "outdated"] as const;
const REPORT_WORD_RE = new RegExp(`\\b(?:${REPORT_WORDS.join("|")})\\b`, "i");

/** True when the text contains one of the report words ("this one is bad", "wrong answer", "please flag"). */
export function hasReportWord(text: string): boolean {
  return REPORT_WORD_RE.test(text);
}

export function isFlagEmoji(e: { id: string | null; name: string | null }): boolean {
  return !e.id && (e.name ?? "").replace(/️/g, "") === FLAG_REACTION;
}

/** Ids of questions pulled from every pool (the admin's disable button and the auto-pull). Never throws. */
export async function getDisabledIds(): Promise<string[]> {
  try {
    return (await loadSettings()).get(SETTING);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Which question a post, reply or command means
// ---------------------------------------------------------------------------------------------------------------

export interface ReportableRound {
  id: number;
  questionId: string;
  status: string;
  messageId: string | null;
  closesAt: Date;
}

/** The Discord round whose question post is `messageId`, if it is within the report window. */
export async function roundByQuestionPost(messageId: string, now: Date = new Date()): Promise<ReportableRound | null> {
  const r = await prisma.triviaRound.findUnique({
    where: { messageId },
    select: { id: true, questionId: true, status: true, messageId: true, closesAt: true, surface: true, openedAt: true },
  });
  if (!r || r.surface !== "DISCORD" || now.getTime() - r.openedAt.getTime() > REPORT_WINDOW_DAYS * DAY_MS) return null;
  return r;
}

/** The most recent Discord round that was actually asked (its question was posted). */
export async function latestAskedRound(): Promise<ReportableRound | null> {
  return prisma.triviaRound.findFirst({
    where: { surface: "DISCORD", messageId: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true, questionId: true, status: true, messageId: true, closesAt: true },
  });
}

/** Message ids of question posts from the last REPORT_WINDOW_DAYS (newest first), for the recorder's flag/reply filter. */
export async function recentQuestionPosts(channelId: string, now: Date = new Date(), limit = 100): Promise<string[]> {
  const rows = await prisma.triviaRound.findMany({
    where: { surface: "DISCORD", channelId, messageId: { not: null }, openedAt: { gte: new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY_MS) } },
    orderBy: { id: "desc" },
    take: limit,
    select: { messageId: true },
  });
  return rows.flatMap((r) => (r.messageId ? [r.messageId] : []));
}

const RECENT_POSTS_TTL_MS = 60_000;
const recentPostsCache = new Map<string, { at: number; value: Promise<string[]> }>();

/**
 * recentQuestionPosts, cached per instance for 60 s (in-flight reads shared), for the recorder's 5 s state poll.
 * A new question post invalidates it in-process (invalidateRecentQuestionPosts); other instances may lag up to 60 s,
 * which only delays flag/report reaction forwarding on a brand-new question post. A failed read is not cached.
 */
export async function cachedRecentQuestionPosts(channelId: string, now: number = Date.now()): Promise<string[]> {
  const hit = recentPostsCache.get(channelId);
  if (hit && now - hit.at < RECENT_POSTS_TTL_MS) return hit.value;
  const entry = { at: now, value: recentQuestionPosts(channelId, new Date(now)) };
  recentPostsCache.set(channelId, entry);
  entry.value.catch(() => {
    if (recentPostsCache.get(channelId) === entry) recentPostsCache.delete(channelId);
  });
  return entry.value;
}

/** Drop the cached question-post list (one channel, or all): call wherever a question post is created or changed. */
export function invalidateRecentQuestionPosts(channelId?: string): void {
  if (channelId === undefined) recentPostsCache.clear();
  else recentPostsCache.delete(channelId);
}

// ---------------------------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------------------------

/** Lock namespace for one member's report on one question (first key of the two-key lock). */
export const REPORT_LOCK_NAMESPACE = 742019344;

export type ReportOutcome = { status: "recorded"; pulled: boolean; eligible: boolean } | { status: "duplicate" };

/** Report row statuses: open (counts, shown to admins), handled (an admin pulled, restored or dismissed it), ineligible (kept, never counted). */
export type ReportStatus = "open" | "handled" | "ineligible";

export interface RecordReportInput {
  questionId: string;
  discordId: string;
  text: string;
  now?: Date;
  /** Already known to be eligible by the caller (it ran the same check). Omit to have it computed here. */
  eligible?: boolean;
}

/**
 * May this member's report count? An onboarded member on a Discord account at least MIN_ACCOUNT_AGE_DAYS old: the same
 * two rules as winning. Throwaway accounts can still report (the row is kept, as `ineligible`) but never count toward a pull.
 */
export async function reporterEligible(discordId: string, now: Date, isMember: (id: string) => Promise<boolean> = async (id) => !!(await fetchMemberIdByDiscordId(id))): Promise<boolean> {
  if (!accountOldEnough(discordId, now)) return false;
  if (!REQUIRE_MEMBER) return true;
  try {
    return await isMember(discordId);
  } catch {
    return false; // fail closed: an unreadable member list never lets a report count
  }
}

/**
 * Record a report (every path: flag, reply, /trivia report, the web form). Eligibility is computed here and stored on the
 * row (status `open` or `ineligible`), so no path can skip it. One report per member per question per REPORT_WINDOW_DAYS:
 * a second is a duplicate, unless the earlier one was handled (an admin dismissed, pulled or restored): then the member
 * can report again. Then the auto-pull is checked. Never an answer attempt: it touches TriviaReport only.
 */
export async function recordReport(input: RecordReportInput): Promise<ReportOutcome> {
  const now = input.now ?? new Date();
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 500) || "flagged from Discord";
  const eligible = input.eligible ?? (await reporterEligible(input.discordId, now));
  const created = await prisma.$transaction(async (tx) => {
    // Serialise this member's reports on this question: two flags at once must not both insert.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REPORT_LOCK_NAMESPACE}::int, hashtext(${`${input.questionId}:${input.discordId}`}))`;
    const existing = await tx.triviaReport.findFirst({
      where: { kind: "report", questionId: input.questionId, discordId: input.discordId, status: { not: "handled" }, createdAt: { gte: new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY_MS) } },
      select: { id: true },
    });
    if (existing) return false;
    await tx.triviaReport.create({ data: { questionId: input.questionId, discordId: input.discordId, text, status: eligible ? "open" : "ineligible", createdAt: now } });
    return true;
  });
  if (!created) return { status: "duplicate" };
  return { status: "recorded", eligible, pulled: eligible ? await autoPullIfNeeded(input.questionId, now) : false };
}

/**
 * Pull the question when REPORT_PULL_MEMBERS different members have an OPEN report on it within the window. Only open rows
 * count: ineligible reporters never do, and reports an admin already handled (dismissed, pulled or restored) never do, so a
 * restore or a dismiss is not undone by the old reports. A restore also closes whatever is still open, which is the cutoff:
 * only reports made afterwards count. Production only (previews
 * share the database and must not change its settings). Logged, never public. Returns whether it pulled it now.
 */
export async function autoPullIfNeeded(questionId: string, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.VERCEL_ENV !== "production") return false;
  try {
    const rows = await prisma.triviaReport.findMany({
      where: { kind: "report", questionId, status: "open", discordId: { not: null }, createdAt: { gte: new Date(now.getTime() - REPORT_WINDOW_DAYS * DAY_MS) } },
      select: { discordId: true },
    });
    const members = new Set(rows.map((r) => r.discordId));
    if (members.size < REPORT_PULL_MEMBERS) return false;
    if ((await getDisabledIds()).includes(questionId)) return false;
    const changed = await setQuestionDisabled(questionId, true, AUTOPULL_ACTOR);
    if (changed) console.warn(`[trivia] auto-pulled ${questionId}: reported by ${members.size} different members within ${REPORT_WINDOW_DAYS} days`);
    return changed;
  } catch (e) {
    console.error(`[trivia] auto-pull check failed for ${questionId}: ${e instanceof Error ? e.message : "error"}`);
    return false;
  }
}

/** Lock namespace for the disabled-questions list (first key of the two-key lock). */
export const DISABLED_LIST_LOCK_NAMESPACE = 742019345;

/**
 * Add or remove a question id in trivia.disabledQuestionIds, atomically: the read-modify-write runs in one transaction
 * under an advisory lock, so concurrent changes (two auto-pulls, an admin's click) cannot lose each other. It writes the
 * setting row and its audit row exactly as the settings page does (the actor is recorded). Returns whether the list
 * changed. Unknown ids are refused.
 */
export async function setQuestionDisabled(questionId: string, disabled: boolean, actor: string): Promise<boolean> {
  if (!(await getQuestion(questionId))) throw new Error(`Unknown question ${questionId}`);
  const changed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DISABLED_LIST_LOCK_NAMESPACE}::int, hashtext(${SETTING}))`;
    const row = await tx.appSetting.findUnique({ where: { key: SETTING }, select: { value: true } });
    const current = Array.isArray(row?.value) ? (row!.value as unknown[]).filter((v): v is string => typeof v === "string") : [];
    if (current.includes(questionId) === disabled) return false;
    const next = disabled ? [...current, questionId] : current.filter((id) => id !== questionId);
    // The same check the settings page applies, before this custom write: a bad list is never stored.
    const valid = parseSetting(SETTING, next);
    if (!valid.ok) throw new Error(`Cannot save the pulled questions: ${valid.error}`);
    await tx.appSetting.upsert({ where: { key: SETTING }, create: { key: SETTING, value: next, updatedBy: actor }, update: { value: next, updatedBy: actor } });
    await tx.appSettingChange.create({
      data: { key: SETTING, oldValue: row ? (row.value as Prisma.InputJsonValue) : Prisma.DbNull, newValue: next, changedBy: actor, note: disabled ? "Question pulled" : "Question restored" },
    });
    return true;
  });
  if (changed) clearSettingsCache();
  return changed;
}

/** Reports grouped by question, newest first, for the admin page. */
export interface ReportGroup {
  questionId: string;
  count: number;
  members: number;
  latestAt: Date;
  texts: { text: string; at: Date; fromDiscord: boolean }[];
}

export async function openReportGroups(limit = 200): Promise<ReportGroup[]> {
  const rows = await prisma.triviaReport.findMany({ where: { kind: "report", status: "open" }, orderBy: { id: "desc" }, take: limit, select: { questionId: true, discordId: true, text: true, createdAt: true } });
  const groups = new Map<string, ReportGroup & { ids: Set<string> }>();
  for (const r of rows) {
    const g = groups.get(r.questionId) ?? { questionId: r.questionId, count: 0, members: 0, latestAt: r.createdAt, texts: [], ids: new Set<string>() };
    g.count++;
    if (r.discordId) g.ids.add(r.discordId);
    if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
    if (g.texts.length < 5) g.texts.push({ text: r.text, at: r.createdAt, fromDiscord: !!r.discordId });
    groups.set(r.questionId, g);
  }
  return [...groups.values()]
    .map(({ ids, ...g }) => ({ ...g, members: ids.size }))
    .sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

/** Mark every open report of a question handled (after the admin acted on it). */
export async function closeReports(questionId: string): Promise<number> {
  return (await prisma.triviaReport.updateMany({ where: { kind: "report", questionId, status: "open" }, data: { status: "handled" } })).count;
}
