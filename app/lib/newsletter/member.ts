// app/lib/newsletter/member.ts
//
// The "Monthly newsletter" checkbox in a member's email preferences. A separate consent from the
// weekly digest opt-in (reengageEmailOptIn is never read or written here).
import { prisma } from "@/app/lib/db";
import { isMailable } from "./consent";
import { findByEmail, requestSubscription, unsubscribeSubscriber } from "./subscribe";

export interface MemberNewsletterState {
  subscribed: boolean;
  pending: boolean;
}

/**
 * The checkbox state for the member's saved address. Only a VERIFIED address is looked up: anyone can
 * type any address into their prefs, so an unverified one must never reveal who is subscribed.
 * "subscribed" means mailable (confirmed), so the box is only ticked for a real subscription.
 */
export async function memberNewsletterState(email: string | null, verified: boolean): Promise<MemberNewsletterState> {
  if (!email || !verified) return { subscribed: false, pending: false };
  const row = await findByEmail(email);
  if (!row) return { subscribed: false, pending: false };
  return { subscribed: isMailable(row), pending: !isMailable(row) && row.status !== "unsubscribed" };
}

/**
 * Apply the member's checkbox. Ticking with a VERIFIED address is the explicit opt-in (the member
 * proved the address, source "member", confirmed now); with an unverified address it goes through the
 * normal double opt-in. Unticking unsubscribes the address.
 */
export async function setMemberNewsletter(
  memberId: string,
  email: string,
  verified: boolean,
  wanted: boolean,
  now = new Date(),
): Promise<void> {
  const addr = email.trim().toLowerCase();
  const found = await findByEmail(addr);
  const existing = found ? { id: found.id, status: found.status, confirmedAt: found.confirmedAt } : null;
  const ownerId = found
    ? (await prisma.newsletterSubscriber.findUnique({ where: { id: found.id }, select: { memberId: true } }))?.memberId ?? null
    : null;
  if (!wanted) {
    // Unticking acts only on an address the member proved (verified) or a row this member created.
    const mayAct = verified || ownerId === memberId;
    if (existing && mayAct && existing.status !== "unsubscribed") await unsubscribeSubscriber(existing.id, "user", now);
    return;
  }
  if (!verified) {
    await requestSubscription({ email: addr, source: "member", memberId }, now.getTime());
    return;
  }
  if (existing && isMailable(existing)) {
    await prisma.newsletterSubscriber.update({ where: { id: existing.id }, data: { memberId } });
    return;
  }
  const data = { status: "subscribed", confirmedAt: now, unsubscribedAt: null, lastStatusReason: null, memberId };
  if (existing) await prisma.newsletterSubscriber.update({ where: { id: existing.id }, data });
  else await prisma.newsletterSubscriber.create({ data: { email: addr, source: "member", ...data } });
}
