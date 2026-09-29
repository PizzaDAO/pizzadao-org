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
// Sources wired:
//   - vouch_received    (Prisma: Vouch where followeeId = memberId)
//   - mission_approved  (Prisma: MissionCompletion where status=APPROVED)
//   - mission_rejected  (Prisma: MissionCompletion where status=REJECTED)
//   - ticket_added      (Prisma: UnlockTicketClaim.connectedAt)
//   - notification      (Prisma: Notification for recipientId=discordId)
//   - task_claimed      (Prisma: TaskClaimEvent — written by /api/claim-task)
//   - poap_received     (Prisma: PoapFirstSeen — written by /api/poaps/[memberId])
//   - role_granted      (Prisma: RoleGrantEvent — written by /api/discord/sync-to-sheet)
//
// The latter three were added in stuffed-crust-39669 (see plan). Each table
// captures the first observation of an event (no historical backfill); the
// feed reads them like any other source.
//
// Plans:
//   - plans/garlic-96648-dashboard-redesign.md §6.3 (original wiring)
//   - plans/stuffed-crust-39669-activity-completeness.md (completeness pass)

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

        // --- Task claims (TaskClaimEvent — written by /api/claim-task) ---
        const taskClaims = await safe(
            prisma.taskClaimEvent.findMany({
                where: { memberId },
                orderBy: { claimedAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: {
                    id: true,
                    taskName: true,
                    sheetUrl: true,
                    claimedAt: true,
                },
            }),
            [] as Array<{
                id: number;
                taskName: string;
                sheetUrl: string | null;
                claimedAt: Date;
            }>,
        );

        for (const c of taskClaims) {
            events.push({
                id: makeId("task_claimed", c.id),
                kind: "task_claimed",
                title: `Claimed task: ${c.taskName}`,
                href: c.sheetUrl,
                at: toISO(c.claimedAt),
            });
        }

        // --- POAPs first-seen (PoapFirstSeen — written by /api/poaps/[memberId]) ---
        const poaps = await safe(
            prisma.poapFirstSeen.findMany({
                where: { memberId },
                orderBy: { firstSeenAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: {
                    id: true,
                    title: true,
                    poapEventId: true,
                    firstSeenAt: true,
                },
            }),
            [] as Array<{
                id: number;
                title: string | null;
                poapEventId: string;
                firstSeenAt: Date;
            }>,
        );

        for (const p of poaps) {
            events.push({
                id: makeId("poap_received", p.id),
                kind: "poap_received",
                title: p.title ? `POAP: ${p.title}` : "POAP received",
                href: `/profile/${memberId}`,
                at: toISO(p.firstSeenAt),
            });
        }

        // --- Role grants (RoleGrantEvent — written by /api/discord/sync-to-sheet) ---
        const grants = await safe(
            prisma.roleGrantEvent.findMany({
                where: { discordId },
                orderBy: { grantedAt: "desc" },
                take: PER_SOURCE_LIMIT,
                select: {
                    id: true,
                    roleName: true,
                    grantedAt: true,
                },
            }),
            [] as Array<{ id: number; roleName: string; grantedAt: Date }>,
        );

        for (const g of grants) {
            events.push({
                id: makeId("role_granted", g.id),
                kind: "role_granted",
                title: `Discord role granted: ${g.roleName}`,
                href: null,
                at: toISO(g.grantedAt),
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
