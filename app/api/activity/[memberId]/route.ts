// app/api/activity/[memberId]/route.ts
//
// Backend-for-frontend endpoint that aggregates the dashboard "Recent
// Activity" feed for one member. Returns up to 20 events sorted descending
// by timestamp. The /dashboard/[id] page surfaces the top 5 via the
// `RecentActivity` component.
//
// Auth: owner-only — viewer (from session.discordId) must resolve to the
// same memberId being requested. Matches the policy used by
// /api/dashboard-summary.
//
// Sources wired in this PR:
//   - vouches received       (Prisma: Vouch where followeeId = memberId)
//   - mission approved       (Prisma: MissionCompletion where status=APPROVED)
//   - mission rejected       (Prisma: MissionCompletion where status=REJECTED)
//   - unlock ticket added    (Prisma: UnlockTicketClaim.connectedAt)
//   - notifications          (Prisma: Notification for recipientId=discordId)
//
// Sources deferred:
//   - task_claimed: Google Sheets does not store a per-claim timestamp, so we
//     have no reliable "when did this claim happen" event. Leaving for a
//     future PR that can either ingest sheet claims into a DB log or rely on
//     a sheet revision feed.
//   - poap_received: POAPs are read live from the public POAP API
//     (/api/poaps/[memberId]) — we don't cache per-member firstSeenAt, so we
//     cannot derive a "received at" event without first persisting them.
//   - role_granted: there is no Discord role audit log in this codebase.
//     Role state is read live from the guild; transitions are not tracked.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §6.3, PR3.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId, fetchMemberById } from "@/app/lib/sheets/member-repository";
import type { ActivityEvent, ActivityKind } from "@/app/dashboard/[id]/lib/activity-types";

export const runtime = "nodejs";

const MAX_EVENTS = 20;
const PER_SOURCE_LIMIT = 10; // pull this many per source; final list is capped.

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
    try {
        return await p;
    } catch {
        return fallback;
    }
}

function toISO(d: Date | string): string {
    return d instanceof Date ? d.toISOString() : String(d);
}

function makeId(kind: ActivityKind, raw: string | number): string {
    return `${kind}:${raw}`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ memberId: string }> },
) {
    try {
        const { memberId } = await params;
        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        // Owner-only check — same shape as /api/dashboard-summary.
        const viewerMemberId = await safe(
            fetchMemberIdByDiscordId(session.discordId),
            null,
        );
        if (!viewerMemberId || viewerMemberId !== memberId) {
            return NextResponse.json(
                { error: "Forbidden: activity is owner-only" },
                { status: 403 },
            );
        }

        const discordId = session.discordId;
        const events: ActivityEvent[] = [];

        // --- Vouches received ---
        const vouches = await safe(
            prisma.vouch.findMany({
                where: { followeeId: memberId },
                orderBy: { createdAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: { id: true, followerId: true, createdAt: true },
            }),
            [] as Array<{ id: number; followerId: string; createdAt: Date }>,
        );

        // Enrich with the voucher's display name. fetchMemberById is cached
        // via the sheets repository so this fan-out is cheap when the same
        // vouchers recur.
        await Promise.all(
            vouches.map(async (v) => {
                const member = await safe(fetchMemberById(v.followerId), null);
                const voucherName = (member?.["Name"] as string)
                    || (member?.["Mafia Name"] as string)
                    || "A community member";
                events.push({
                    id: makeId("vouch_received", v.id),
                    kind: "vouch_received",
                    title: `${voucherName} vouched for you`,
                    href: `/profile/${v.followerId}`,
                    at: toISO(v.createdAt),
                });
            }),
        );

        // --- Mission completions (approved / rejected) ---
        const completions = await safe(
            prisma.missionCompletion.findMany({
                where: {
                    discordId,
                    status: { in: ["APPROVED", "REJECTED"] },
                },
                orderBy: { reviewedAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: {
                    id: true,
                    status: true,
                    reviewedAt: true,
                    submittedAt: true,
                    missionId: true,
                    mission: { select: { title: true, level: true } },
                },
            }),
            [] as Array<{
                id: number;
                status: string;
                reviewedAt: Date | null;
                submittedAt: Date;
                missionId: number;
                mission: { title: string; level: number };
            }>,
        );

        for (const c of completions) {
            const reviewedAt = c.reviewedAt ?? c.submittedAt;
            if (c.status === "APPROVED") {
                events.push({
                    id: makeId("mission_approved", c.id),
                    kind: "mission_approved",
                    title: `Mission approved: ${c.mission.title}`,
                    href: `/missions#mission-${c.missionId}`,
                    at: toISO(reviewedAt),
                });
            } else if (c.status === "REJECTED") {
                events.push({
                    id: makeId("mission_rejected", c.id),
                    kind: "mission_rejected",
                    title: `Mission needs changes: ${c.mission.title}`,
                    href: `/missions#mission-${c.missionId}`,
                    at: toISO(reviewedAt),
                });
            }
        }

        // --- Unlock tickets (each claim row = one "ticket(s) added" event) ---
        const ticketClaims = await safe(
            prisma.unlockTicketClaim.findMany({
                where: { memberId },
                orderBy: { connectedAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: { id: true, connectedAt: true, ticketCount: true },
            }),
            [] as Array<{ id: number; connectedAt: Date; ticketCount: number }>,
        );

        for (const t of ticketClaims) {
            const plural = t.ticketCount === 1 ? "ticket" : "tickets";
            events.push({
                id: makeId("ticket_added", t.id),
                kind: "ticket_added",
                title: `${t.ticketCount} Unlock ${plural} linked`,
                href: `/profile/${memberId}`,
                at: toISO(t.connectedAt),
            });
        }

        // --- Notifications (treat each as one feed event) ---
        const notifications = await safe(
            prisma.notification.findMany({
                where: { recipientId: discordId },
                orderBy: { createdAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: {
                    id: true,
                    title: true,
                    linkUrl: true,
                    createdAt: true,
                },
            }),
            [] as Array<{ id: string; title: string; linkUrl: string | null; createdAt: Date }>,
        );

        for (const n of notifications) {
            events.push({
                id: makeId("notification", n.id),
                kind: "notification",
                title: n.title,
                href: n.linkUrl,
                at: toISO(n.createdAt),
            });
        }

        // Sort and cap.
        events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
        const top = events.slice(0, MAX_EVENTS);

        return NextResponse.json(
            { events: top },
            {
                headers: {
                    "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
                },
            },
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Failed to load activity";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
