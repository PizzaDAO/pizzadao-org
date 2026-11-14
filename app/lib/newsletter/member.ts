// app/lib/newsletter/member.ts
//
// The "Monthly newsletter" checkbox in a member's email preferences. A separate consent from the
// weekly digest opt-in (reengageEmailOptIn is never read or written here).
import { prisma } from "@/app/lib/db";
import { isMailable } from "./consent";
import { requestSubscription, unsubscribeSubscriber } from "./subscribe";

export interface MemberNewsletterState {
  subscribed: boolean;
  pending: boolean;
}

export async function memberNewsletterState(email: string | null): Promise<MemberNewsletterState> {
  if (!email) return { subscribed: false, pending: false };
  const row = await prisma.newsletterSubscriber.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { status: true, confirmedAt: true },
  });
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
  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: addr },
    select: { id: true, status: true, confirmedAt: true },
  });
  if (!wanted) {
    if (existing && existing.status !== "unsubscribed") await unsubscribeSubscriber(existing.id, "user", now);
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
