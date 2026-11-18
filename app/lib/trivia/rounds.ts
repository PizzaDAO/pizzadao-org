// app/lib/trivia/rounds.ts
//
// Discord rounds: open, claim, expire, cancel (plans/trivia.md sections 6 and 7). All DB state lives in
// TriviaRound / TriviaAttempt; the only things that leave the process are the injected `post` calls and the
// TRIVIA_REWARD ledger credit (creditInTx, inside the claim transaction).
//
// First correct answer wins, atomically (claimWin):
//   1. a replayed Discord message id is a retry: return what it was, change nothing;
//   2. attempt caps are checked, then the attempt is stored;
//   3. a correct, eligible answer runs one conditional UPDATE ... WHERE status = 'OPEN' AND closesAt > now.
//      count = 1: this answer won, and the ledger credit is written in the same transaction; count = 0: late.
// The round row's single winner is the idempotency key for the payout, so a race or a replay cannot pay twice.
import { prisma } from "@/app/lib/db";
import { creditInTx, getOrCreateEconomy } from "@/app/lib/economy";
import { DiscordPostError, postDiscordMessage, type DiscordMessageBody } from "@/app/lib/discord-rest";
import { getQuestion, servable } from "./bank";
import { MAX_WINS_PER_USER_PER_DAY, RECENT_ROUNDS_LOOKBACK, ROUND_MINUTES, STALE_REVEAL_MINUTES } from "./config";
import { dayStartMs } from "./daily";
import { cancelledMessage, explanationMessage, questionMessage, revealMessage, winnerMessage } from "./post";
import { pickQuestion } from "./schedule";
import type { TriviaQuestion } from "./schema";

export interface PostDeps {
  post(channelId: string, body: DiscordMessageBody): Promise<{ id: string | null }>;
}

/** Posts as the PizzaDAO bot (the same token the other cron posts use). */
export const defaultPostDeps: PostDeps = {
  post: (channelId, body) => postDiscordMessage({ kind: "bot", channelId, botToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? "" }, body),
};

type RoundRow = { id: number; questionId: string; channelId: string | null; messageId: string | null; rewardPep: number; openedAt: Date; closesAt: Date };

// ---------------------------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------------------------

/** Recent Discord question ids (newest first) and open times, for the picker and the slot schedule. */
export async function recentDiscordRounds(limit = RECENT_ROUNDS_LOOKBACK): Promise<{ questionId: string; openedAt: Date }[]> {
  return prisma.triviaRound.findMany({
    where: { surface: "DISCORD", status: { not: "CANCELLED" } },
    orderBy: { id: "desc" },
    take: limit,
    select: { questionId: true, openedAt: true },
  });
}

export type OpenResult =
  | { ok: true; roundId: number; questionId: string; messageId: string | null }
  | { ok: false; reason: "busy" | "open_exists" | "no_question" | "post_failed"; detail?: string };

export interface OpenOptions {
  now?: Date;
  channelId: string;
  /** 0 = dry run: the post says nothing is paid and the winner gets nothing. */
  rewardPep: number;
  disabledIds?: Iterable<string>;
  /** Use this question instead of picking one (tests). */
  question?: TriviaQuestion;
  rng?: () => number;
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2002";
}

/**
 * Open a Discord round in `channelId` and post its question. Only the discord pool is ever used, never web or fun-*.
 *
 * Two crons racing: the row is created under a Postgres advisory transaction lock, and a partial unique index
 * ("at most one OPEN DISCORD round per channel", in the phase 1 migration) is the backstop. The post happens after
 * the row exists and commits; if it fails the round is cancelled again, so nothing stays open without a question.
 */
export async function openDiscordRound(opts: OpenOptions, deps: PostDeps = defaultPostDeps): Promise<OpenResult> {
  const now = opts.now ?? new Date();
  let question = opts.question;
  if (!question) {
    const pool = servable({ now, pool: "discord", disabledIds: opts.disabledIds });
    const recent = await recentDiscordRounds();
    question = pickQuestion(pool, { recentIds: recent.map((r) => r.questionId), rng: opts.rng }) ?? undefined;
  }
  if (!question) return { ok: false, reason: "no_question" };
  const q = question;

  let roundId: number;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('trivia-open')) AS locked`;
      if (!lock?.locked) return "busy" as const;
      const open = await tx.triviaRound.findFirst({ where: { surface: "DISCORD", status: "OPEN", channelId: opts.channelId }, select: { id: true } });
      if (open) return "open_exists" as const;
      const row = await tx.triviaRound.create({
        data: {
          surface: "DISCORD",
          questionId: q.id,
          status: "OPEN",
          channelId: opts.channelId,
          rewardPep: opts.rewardPep,
          openedAt: now,
          closesAt: new Date(now.getTime() + ROUND_MINUTES * 60_000),
        },
        select: { id: true },
      });
      return row.id;
    });
    if (typeof created === "string") return { ok: false, reason: created };
    roundId = created;
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: "open_exists" };
    throw e;
  }

  try {
    const posted = await deps.post(opts.channelId, questionMessage(q, opts.rewardPep));
    if (posted.id) await prisma.triviaRound.update({ where: { id: roundId }, data: { messageId: posted.id } });
    return { ok: true, roundId, questionId: q.id, messageId: posted.id };
  } catch (e) {
    // Nobody could have seen a question: close the round so the next tick can try again.
    await prisma.triviaRound.updateMany({ where: { id: roundId, status: "OPEN" }, data: { status: "CANCELLED" } }).catch(() => undefined);
    const detail = e instanceof DiscordPostError ? `Discord ${e.status}` : e instanceof Error ? e.message.slice(0, 120) : "error";
    console.error(`[trivia] question post failed for round ${roundId}: ${detail}`);
    return { ok: false, reason: "post_failed", detail };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------------------------------------------

export type Eligibility = { ok: true } | { ok: false; reason: "not_member" | "too_young" };

export interface ClaimInput {
  round: { id: number; rewardPep: number; questionId: string };
  discordId: string;
  /** The Discord message id of the answer (idempotency key for recorder retries). */
  messageId: string;
  answerText: string;
  correct: boolean;
  /** Only looked at for a correct answer. */
  eligibility: Eligibility;
  /** Attempts this member gets in this round. */
  maxAttempts: number;
  now?: Date;
}

export type ClaimResult =
  | { kind: "won"; rewardPep: number; paid: boolean }
  | { kind: "wrong" }
  | { kind: "ineligible"; reason: "not_member" | "too_young" }
  | { kind: "daily_cap" }
  | { kind: "late" }
  | { kind: "closed" }
  | { kind: "attempts_exhausted" }
  | { kind: "duplicate"; correct: boolean; won: boolean };

/** Atomic first-correct-wins claim. See the file header. Safe to call any number of times in parallel. */
export async function claimWin(input: ClaimInput): Promise<ClaimResult> {
  // The wallet row must exist before the transaction (creditInTx only updates it), as doWork does.
  if (input.correct && input.eligibility.ok && input.round.rewardPep > 0) await getOrCreateEconomy(input.discordId);
  for (let attempt = 0; ; attempt++) {
    try {
      return await claimInTx(input);
    } catch (e) {
      // Two deliveries of the same Discord message raced to insert it: the loser re-reads it as a duplicate.
      if (isUniqueViolation(e) && attempt === 0) continue;
      throw e;
    }
  }
}

async function claimInTx(input: ClaimInput): Promise<ClaimResult> {
  const now = input.now ?? new Date();
  const { round, discordId, messageId } = input;
  return prisma.$transaction(
    async (tx) => {
      const dup = await tx.triviaAttempt.findUnique({ where: { messageId }, select: { correct: true, roundId: true } });
      if (dup) {
        const r = await tx.triviaRound.findUnique({ where: { id: dup.roundId }, select: { winnerMessageId: true } });
        return { kind: "duplicate", correct: dup.correct, won: r?.winnerMessageId === messageId } as const;
      }

      const current = await tx.triviaRound.findUnique({ where: { id: round.id }, select: { status: true, closesAt: true } });
      if (!current || current.status !== "OPEN" || current.closesAt <= now) return { kind: "closed" } as const;

      const used = await tx.triviaAttempt.count({ where: { roundId: round.id, discordId } });
      if (used >= input.maxAttempts) return { kind: "attempts_exhausted" } as const;

      await tx.triviaAttempt.create({
        data: { roundId: round.id, discordId, messageId, correct: input.correct, answerText: input.answerText.slice(0, 120) },
      });
      if (!input.correct) return { kind: "wrong" } as const;
      if (!input.eligibility.ok) return { kind: "ineligible", reason: input.eligibility.reason } as const;

      // A member wins at most MAX_WINS_PER_USER_PER_DAY a day; past that the round stays open for others.
      const wins = await tx.triviaRound.count({
        where: { surface: "DISCORD", status: "WON", winnerDiscordId: discordId, wonAt: { gte: new Date(dayStartMs(now.toISOString().slice(0, 10))) } },
      });
      if (wins >= MAX_WINS_PER_USER_PER_DAY) return { kind: "daily_cap" } as const;

      const claimed = await tx.triviaRound.updateMany({
        where: { id: round.id, status: "OPEN", closesAt: { gt: now } },
        data: { status: "WON", winnerDiscordId: discordId, winnerMessageId: messageId, wonAt: now },
      });
      if (claimed.count !== 1) return { kind: "late" } as const;

      const pay = round.rewardPep > 0;
      if (pay) {
        await creditInTx(tx, discordId, round.rewardPep, "TRIVIA_REWARD", "Trivia win", { roundId: round.id, questionId: round.questionId });
      }
      return { kind: "won", rewardPep: round.rewardPep, paid: pay } as const;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------------------------------------------

async function safePost(deps: PostDeps, channelId: string, body: DiscordMessageBody, what: string): Promise<string | null> {
  try {
    return (await deps.post(channelId, body)).id;
  } catch (e) {
    // A failed post is logged and the outcome (payout, expiry) stands.
    console.error(`[trivia] ${what} post failed: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
    return null;
  }
}

/**
 * Expire OPEN Discord rounds past their close time and post the answer (once: the status flip is the claim).
 * A round that expired long ago (the loop was off) is closed silently. Returns how many were expired.
 */
export async function expireRounds(now: Date = new Date(), deps: PostDeps = defaultPostDeps): Promise<number> {
  const due: RoundRow[] = await prisma.triviaRound.findMany({
    where: { surface: "DISCORD", status: "OPEN", closesAt: { lte: now } },
    select: { id: true, questionId: true, channelId: true, messageId: true, rewardPep: true, openedAt: true, closesAt: true },
  });
  let expired = 0;
  for (const r of due) {
    const flipped = await prisma.triviaRound.updateMany({ where: { id: r.id, status: "OPEN", closesAt: { lte: now } }, data: { status: "EXPIRED" } });
    if (flipped.count !== 1) continue; // someone won it, or another run expired it
    expired++;
    const q = getQuestion(r.questionId);
    const fresh = now.getTime() - r.closesAt.getTime() <= STALE_REVEAL_MINUTES * 60_000;
    if (q && r.channelId && r.messageId && fresh) await safePost(deps, r.channelId, revealMessage(q), `reveal for round ${r.id}`);
  }
  return expired;
}

/** Post the winner reply and the explanation for a round just won. Failures are logged; the payout stands. */
export async function announceWin(
  round: { id: number; channelId: string | null; questionId: string },
  win: { discordId: string; messageId: string; rewardPep: number; paid: boolean },
  deps: PostDeps = defaultPostDeps,
): Promise<void> {
  if (!round.channelId) return;
  await safePost(deps, round.channelId, winnerMessage(win.discordId, win.rewardPep, win.paid, win.messageId), `winner for round ${round.id}`);
  const q = getQuestion(round.questionId);
  if (q) await safePost(deps, round.channelId, explanationMessage(q), `explanation for round ${round.id}`);
}

/** /trivia skip: cancel the open Discord round in the channel (no payout) and say so. Returns whether one was open. */
export async function cancelOpenRound(channelId: string, deps: PostDeps = defaultPostDeps): Promise<boolean> {
  const open = await prisma.triviaRound.findFirst({ where: { surface: "DISCORD", status: "OPEN", channelId }, select: { id: true, messageId: true } });
  if (!open) return false;
  const flipped = await prisma.triviaRound.updateMany({ where: { id: open.id, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (flipped.count !== 1) return false;
  await safePost(deps, channelId, cancelledMessage(), `cancel for round ${open.id}`);
  return true;
}

/** The OPEN Discord round of a channel that is still within its time, or null. */
export async function findOpenRound(channelId: string, now: Date = new Date()): Promise<(RoundRow & { messageId: string | null }) | null> {
  return prisma.triviaRound.findFirst({
    where: { surface: "DISCORD", status: "OPEN", channelId, closesAt: { gt: now } },
    select: { id: true, questionId: true, channelId: true, messageId: true, rewardPep: true, openedAt: true, closesAt: true },
  });
}
