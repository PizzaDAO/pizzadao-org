// app/lib/newsletter/consent.ts
//
// The consent state machine for NewsletterSubscriber, pure functions only.
//
//   (none) --signup--> pending --confirm--> subscribed (confirmedAt set) --unsubscribe--> unsubscribed
//   unsubscribed --signup--> pending (a new confirmation is required)
//   legacy: status "subscribed" with confirmedAt null = never confirmed = NOT mailable; treated as pending.
//
// Only a row that is subscribed AND has confirmedAt may ever be mailed.

export interface ConsentRow {
  status: string;
  confirmedAt: Date | null;
  confirmSentAt: Date | null;
  confirmSends: number;
}

export const CONFIRM_MIN_GAP_MS = 60 * 60 * 1000; // one confirmation email per address per hour
export const CONFIRM_DAY_MS = 24 * 60 * 60 * 1000;
export const CONFIRM_DAILY_CAP = 3; // and at most this many per rolling day

export function isMailable(row: Pick<ConsentRow, "status" | "confirmedAt">): boolean {
  return row.status === "subscribed" && row.confirmedAt !== null;
}

export function isLegacyUnconfirmed(row: Pick<ConsentRow, "status" | "confirmedAt">): boolean {
  return row.status === "subscribed" && row.confirmedAt === null;
}

/** What a signup does to the row. "none": already confirmed, nothing to do (and no email). */
export function signupAction(row: ConsentRow | null): "create" | "none" | "reconfirm" {
  if (!row) return "create";
  return isMailable(row) ? "none" : "reconfirm";
}

/** Sends counted inside the rolling day (the counter restarts once the last send is a day old). */
export function sendsToday(row: Pick<ConsentRow, "confirmSentAt" | "confirmSends">, now: number): number {
  if (!row.confirmSentAt || now - row.confirmSentAt.getTime() >= CONFIRM_DAY_MS) return 0;
  return row.confirmSends;
}

export function confirmThrottle(row: Pick<ConsentRow, "confirmSentAt" | "confirmSends"> | null, now: number): "ok" | "too_soon" | "too_many" {
  if (!row || !row.confirmSentAt) return "ok";
  if (now - row.confirmSentAt.getTime() < CONFIRM_MIN_GAP_MS) return "too_soon";
  return sendsToday(row, now) >= CONFIRM_DAILY_CAP ? "too_many" : "ok";
}

/**
 * Whether a confirm link issued at `issuedAt` may confirm this row. An unsubscribe after the link
 * was issued cancels it (re-subscribing needs a fresh link).
 */
export function canConfirm(row: { unsubscribedAt: Date | null }, issuedAt: number): boolean {
  return !(row.unsubscribedAt && row.unsubscribedAt.getTime() > issuedAt);
}
