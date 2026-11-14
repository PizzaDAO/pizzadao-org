// app/lib/newsletter/subscribe.ts
//
// Server side of the double opt-in. `requestSubscription` is what POST /api/public/newsletter calls:
// it never reports what it did (the route answers the same in every case), it stores the signup as
// pending and sends the confirmation email when that is switched on and a sender is configured.
// `confirmSubscriber` / `unsubscribeSubscriber` are the state changes behind the signed links.
import { prisma } from "@/app/lib/db";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { canConfirm, confirmThrottle, CONFIRM_MIN_GAP_MS, sendsToday, signupAction, type ConsentRow } from "./consent";
import { sendNewsletterConfirm } from "./confirm-mail";
import { newsletterSender } from "./sender";

const SELECT = {
  id: true,
  email: true,
  status: true,
  confirmedAt: true,
  confirmSentAt: true,
  confirmSends: true,
} as const;

type Row = ConsentRow & { id: string; email: string };

/** Case-insensitive, so a mixed-case legacy row is found and never duplicated by a lower-cased signup. */
export function findByEmail(email: string) {
  return prisma.newsletterSubscriber.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } },
    select: SELECT,
  });
}

export type SignupOutcome = "created" | "reconfirm" | "none";

export interface SignupInput {
  email: string;
  source: string;
  memberId?: string | null;
}

/** Store the signup (pending) and, when allowed and not throttled, send the confirmation email. */
export async function requestSubscription(input: SignupInput, now = Date.now()): Promise<SignupOutcome> {
  const settings = await loadSettings();
  let row = (await findByEmail(input.email)) as Row | null;
  let outcome: SignupOutcome = "none";

  if (signupAction(row) === "create") {
    try {
      row = (await prisma.newsletterSubscriber.create({
        data: { email: input.email, source: input.source, status: "pending", ...(input.memberId ? { memberId: input.memberId } : {}) },
        select: SELECT,
      })) as Row;
      outcome = "created";
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
      row = (await findByEmail(input.email)) as Row | null;
    }
  }
  if (!row) return outcome;

  if (outcome !== "created") {
    if (signupAction(row) === "none") return "none";
    outcome = "reconfirm";
    // Unsubscribed or legacy unconfirmed: back to pending; a confirmation is required.
    if (row.status !== "pending") {
      await prisma.newsletterSubscriber.update({
        where: { id: row.id },
        // memberId is deliberately not written here: this address may belong to someone else.
        data: { status: "pending", confirmedAt: null },
      });
    }
  }

  const sender = newsletterSender(settings);
  if (!resolveToggle("newsletter.confirmEmailsEnabled", settings) || !sender) return outcome;
  if (confirmThrottle(row, now) !== "ok") return outcome;

  // Claim the hourly slot atomically so concurrent signups cannot double-send.
  const claimed = await prisma.newsletterSubscriber.updateMany({
    where: { id: row.id, OR: [{ confirmSentAt: null }, { confirmSentAt: { lt: new Date(now - CONFIRM_MIN_GAP_MS) } }] },
    data: { confirmSentAt: new Date(now), confirmSends: sendsToday(row, now) + 1 },
  });
  if (claimed.count !== 1) return outcome;
  const res = await sendNewsletterConfirm({ id: row.id, email: row.email }, sender, "signup");
  if (!res.ok) console.warn("[newsletter] confirm email not sent:", res.reason);
  return outcome;
}

export type ConfirmResult = "confirmed" | "already" | "invalid";

/** The state change behind the confirm link's POST. `issuedAt` comes from the verified token. */
export async function confirmSubscriber(id: string, issuedAt: number, now = new Date()): Promise<ConfirmResult> {
  const row = await prisma.newsletterSubscriber.findUnique({
    where: { id },
    select: { id: true, status: true, confirmedAt: true, unsubscribedAt: true },
  });
  if (!row || !canConfirm(row, issuedAt)) return "invalid";
  if (row.status === "subscribed" && row.confirmedAt) return "already";
  // Conditional write: an unsubscribe that lands after the check above (and after the link was
  // issued) wins, so a confirm can never undo it.
  const res = await prisma.newsletterSubscriber.updateMany({
    where: { id, OR: [{ unsubscribedAt: null }, { unsubscribedAt: { lte: new Date(issuedAt) } }] },
    data: { status: "subscribed", confirmedAt: now, unsubscribedAt: null, lastStatusReason: null },
  });
  return res.count === 1 ? "confirmed" : "invalid";
}

/** Idempotent: an already unsubscribed row is left as it is (keeps the first unsubscribedAt). */
export async function unsubscribeSubscriber(id: string, reason = "user", now = new Date()): Promise<"unsubscribed" | "already" | "missing"> {
  const row = await prisma.newsletterSubscriber.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!row) return "missing";
  if (row.status === "unsubscribed") return "already";
  await prisma.newsletterSubscriber.update({
    where: { id },
    data: { status: "unsubscribed", unsubscribedAt: now, lastStatusReason: reason },
  });
  return "unsubscribed";
}
