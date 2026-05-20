// app/api/dashboard-summary/route.ts
//
// Backend-for-frontend endpoint for /dashboard/[id]. Replaces ~8 concurrent
// client fetches (user-data + missions + balance + tasks + vouches + wallets
// + x + notifications) with one server-composed payload.
//
// Auth: owner-only. The viewer (from the session cookie) must own the
// requested memberId, otherwise 403.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §6.3
// PR: olive-83105 (PR2 of 5).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchMemberById, fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getBalance } from "@/app/lib/economy";
import {
    getMissionsByLevel,
    getUserMissionProgress,
    getCurrentLevel,
    getLevelTitle,
} from "@/app/lib/missions";
import { getVouchCounts } from "@/app/lib/vouches";
import { getNotifications, getUnreadCount } from "@/app/lib/notifications";
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { fetchMyTasksForCrew } from "@/app/lib/my-tasks";
import { resolveNextAction, type NextAction } from "@/app/dashboard/[id]/lib/next-action";
import { hasAnyRole } from "@/app/lib/discord";
import { MISSION_REVIEWER_ROLE_IDS } from "@/app/ui/constants";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DashboardSummary {
    member: {
        id: string;
        name: string;
        pfpUrl: string | null;
        city: string;
        /** Crew label/id list parsed from the member's "Crews" cell. */
        crews: string[];
    };
    level: {
        current: number;
        title: string | null;
        completedThisLevel: number;
        totalThisLevel: number;
        nextMission: { id: number; title: string } | null;
    };
    pep: { balance: number };
    vouches: { total: number; recent: number };
    wallets: { count: number; hasPrimary: boolean };
    x: { connected: boolean; username?: string };
    crewsHydrated: Array<{
        id: string;
        label: string;
        emoji?: string;
        callTime?: string;
        callTimeUrl?: string;
        callLength?: string;
        claimedTaskCount: number;
        doneCount: number;
    }>;
    notifications: {
        unread: number;
        top: Array<{
            id: string;
            title: string;
            message: string;
            linkUrl: string | null;
            createdAt: string;
        }>;
    };
    nextAction: NextAction;
}

// ---------------------------------------------------------------------------
// In-memory cache (keyed by memberId). 60s TTL — short, owner-only.
// ---------------------------------------------------------------------------

interface CacheEntry { time: number; data: DashboardSummary }
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCrews(raw: unknown): string[] {
    const s = String(raw ?? "").trim();
    if (!s || s.toLowerCase() === "none") return [];
    return s
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
    try {
        return await p;
    } catch {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        // Pick memberId source: query string takes precedence; fall back to
        // resolving from the session's Discord ID.
        const requestedMemberId =
            request.nextUrl.searchParams.get("memberId") ||
            (await safe(fetchMemberIdByDiscordId(session.discordId), null));

        if (!requestedMemberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // Owner-only check: resolve viewer's memberId via Discord ID and
        // require equality with the requested one.
        const viewerMemberId = await safe(
            fetchMemberIdByDiscordId(session.discordId),
            null
        );
        if (!viewerMemberId || viewerMemberId !== requestedMemberId) {
            return NextResponse.json(
                { error: "Forbidden: dashboard is owner-only" },
                { status: 403 }
            );
        }

        // Cache hit?
        const cached = CACHE.get(requestedMemberId);
        if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
            return NextResponse.json(cached.data, {
                headers: {
                    "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
                },
            });
        }

        const memberId = requestedMemberId;
        const discordId = session.discordId;

        // --- Parallel data fetch ---
        const [
            member,
            balance,
            missionsByLevel,
            progress,
            currentLevel,
            vouchCounts,
            walletRows,
            xRow,
            notifications,
            unreadCount,
            crewMappings,
        ] = await Promise.all([
            safe(fetchMemberById(memberId), null),
            safe(getBalance(discordId), { balance: 0 }),
            safe(getMissionsByLevel(), {} as Awaited<ReturnType<typeof getMissionsByLevel>>),
            safe(
                getUserMissionProgress(discordId),
                [] as Awaited<ReturnType<typeof getUserMissionProgress>>
            ),
            safe(getCurrentLevel(discordId), 1),
            safe(getVouchCounts(memberId), {
                total: 0,
                pizzadao: 0,
                farcaster: 0,
                twitter: 0,
                followers: 0,
            }),
            safe(
                prisma.memberWallet.findMany({
                    where: { memberId },
                    select: { isPrimary: true },
                }),
                [] as Array<{ isPrimary: boolean }>
            ),
            safe(
                (prisma as any).xAccount.findFirst({
                    where: { memberId },
                    select: { xUsername: true, xDisplayName: true },
                }) as Promise<{ xUsername: string; xDisplayName?: string } | null>,
                null as { xUsername: string; xDisplayName?: string } | null
            ),
            safe(getNotifications(discordId, 5), []),
            safe(getUnreadCount(discordId), 0),
            safe(getCrewMappings(), { crews: [] as CrewOption[], cached: false }),
        ]);

        // Reviewer detection — pulled in parallel-after-session so the Discord
        // guild fetch doesn't gate the rest of the payload. `hasAnyRole`
        // already caches the guild-member lookup for 60s.
        const isReviewer = await safe(
            hasAnyRole(discordId, MISSION_REVIEWER_ROLE_IDS),
            false,
        );

        // --- Level info ---
        const levelTitle = await safe(getLevelTitle(currentLevel), null);
        const currentLevelMissions = (missionsByLevel as any)[currentLevel] || [];
        const completedThisLevel = currentLevelMissions.filter((m: { id: number }) =>
            progress.some(
                (p: { missionId: number; status: string }) =>
                    p.missionId === m.id && p.status === "APPROVED"
            )
        ).length;
        const totalThisLevel = currentLevelMissions.length;

        // Next mission: first level-N mission with no progress entry yet.
        const submittedMissionIds = new Set(
            progress.map((p: { missionId: number }) => p.missionId)
        );
        const nextMissionRaw = currentLevelMissions.find(
            (m: { id: number }) => !submittedMissionIds.has(m.id)
        );
        const nextMission = nextMissionRaw
            ? { id: nextMissionRaw.id, title: nextMissionRaw.title }
            : null;

        // awaitingReview: all level missions submitted, at least one still PENDING.
        const levelProgressEntries = progress.filter(
            (p: { missionId: number }) =>
                currentLevelMissions.some((m: { id: number }) => m.id === p.missionId)
        );
        const awaitingReview =
            totalThisLevel > 0 &&
            levelProgressEntries.length === totalThisLevel &&
            levelProgressEntries.some(
                (p: { status: string }) => p.status === "PENDING"
            );

        // --- Member core ---
        const memberCrews = parseCrews(member?.["Crews"]);
        const memberName = String(
            member?.["Name"] || member?.["Mafia Name"] || "Anonymous Pizza Maker"
        );
        const memberCity = String(member?.["City"] || "Worldwide");

        // PFP — synchronous fs.exists, but cheap. Mirror /api/pfp/[memberId].
        let pfpUrl: string | null = null;
        try {
            const fs = await import("fs");
            const path = await import("path");
            const pfpDir = path.join(process.cwd(), "public", "pfp");
            const jpgPath = path.join(pfpDir, `${memberId}.jpg`);
            const pngPath = path.join(pfpDir, `${memberId}.png`);
            if (fs.existsSync(jpgPath)) pfpUrl = `/pfp/${memberId}.jpg`;
            else if (fs.existsSync(pngPath)) pfpUrl = `/pfp/${memberId}.png`;
            else {
                const defaultJpg = path.join(pfpDir, "default.jpg");
                const defaultPng = path.join(pfpDir, "default.png");
                if (fs.existsSync(defaultJpg)) pfpUrl = `/pfp/default.jpg`;
                else if (fs.existsSync(defaultPng)) pfpUrl = `/pfp/default.png`;
            }
        } catch {
            pfpUrl = null;
        }

        // --- Wallets ---
        const wallets = {
            count: walletRows.length,
            hasPrimary: walletRows.some((w) => w.isPrimary),
        };

        // --- X account ---
        const x = xRow
            ? { connected: true, username: xRow.xUsername }
            : { connected: false };

        // --- Crews hydrated (with per-crew claimed/done counts) ---
        // Limit to crews the member belongs to so we don't fan out to every
        // crew sheet. Match by id or label (case-insensitive).
        const memberCrewSet = new Set(
            memberCrews.map((c) => c.toLowerCase())
        );
        const myCrewOptions = crewMappings.crews.filter(
            (c) =>
                memberCrewSet.has(c.id.toLowerCase()) ||
                memberCrewSet.has(c.label.toLowerCase())
        );

        const crewsHydrated = await Promise.all(
            myCrewOptions.map(async (c) => {
                const taskData = c.sheet
                    ? await safe(fetchMyTasksForCrew(c.sheet, memberId), {
                          active: [],
                          doneCount: 0,
                      })
                    : { active: [], doneCount: 0 };
                return {
                    id: c.id,
                    label: c.label,
                    emoji: c.emoji,
                    callTime: c.callTime,
                    callTimeUrl: c.callTimeUrl,
                    callLength: c.callLength,
                    claimedTaskCount: taskData.active.length,
                    doneCount: taskData.doneCount,
                };
            })
        );

        // --- Notifications (top 3) ---
        const topNotifications = (notifications || []).slice(0, 3).map((n: any) => ({
            id: n.id,
            title: n.title,
            message: n.message,
            linkUrl: n.linkUrl ?? null,
            createdAt:
                n.createdAt instanceof Date
                    ? n.createdAt.toISOString()
                    : String(n.createdAt),
        }));

        // --- Compute next action ---
        const topUnread = (notifications || []).find((n: any) => !n.readAt);
        const nextAction = resolveNextAction({
            member: { id: memberId, crews: memberCrews },
            level: {
                current: currentLevel,
                title: levelTitle,
                completedThisLevel,
                totalThisLevel,
                nextMission,
                awaitingReview,
            },
            vouches: { total: vouchCounts.total },
            wallets: { count: wallets.count },
            x: { connected: x.connected },
            notifications: {
                unread: unreadCount,
                top: topUnread
                    ? {
                          id: topUnread.id,
                          title: topUnread.title,
                          linkUrl: topUnread.linkUrl ?? null,
                      }
                    : null,
            },
            isReviewer,
        });

        const summary: DashboardSummary = {
            member: {
                id: memberId,
                name: memberName,
                pfpUrl,
                city: memberCity,
                crews: memberCrews,
            },
            level: {
                current: currentLevel,
                title: levelTitle,
                completedThisLevel,
                totalThisLevel,
                nextMission,
            },
            pep: { balance: balance.balance ?? 0 },
            vouches: {
                total: vouchCounts.total,
                recent: 0, // populated by future activity feed (PR3)
            },
            wallets,
            x,
            crewsHydrated,
            notifications: { unread: unreadCount, top: topNotifications },
            nextAction,
        };

        CACHE.set(memberId, { time: Date.now(), data: summary });

        return NextResponse.json(summary, {
            headers: {
                "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
            },
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Failed to load dashboard summary";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
