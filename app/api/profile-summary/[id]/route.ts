// app/api/profile-summary/[id]/route.ts
//
// Backend-for-frontend endpoint for /profile/[id]. Replaces ~8 concurrent
// client fetches (profile + pfp + x + mission progress + me + crew mappings
// + mafia rank + vouch counts) with one server-composed payload.
//
// Plan: plans/truffle-91035-profile-redesign.md §6.3 — PR3 (capricciosa-16483).
//
// PUBLIC endpoint (no auth required); strips the same sensitive sheet fields
// the existing /api/profile/[id] route strips. The viewer's session is read
// opportunistically so we can return isOwner / viewerId without a round-trip,
// but unauthenticated callers always get the public-safe payload.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberById, fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getVouchCounts } from "@/app/lib/vouches";
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { prisma } from "@/app/lib/db";
import { getMemberTagline } from "@/app/api/profile-extras/[id]/route";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Output type — the contract useProfileSummary already exposes to the page.
// ---------------------------------------------------------------------------

export interface ProfileSummary {
    hero: {
        name: string;
        pfpUrl: string | null;
        tagline: string;
        city: string;
        /** 1..8 numeric, "MAX" when >8, or null when no progress yet. */
        level: number | string | null;
        levelTitle: string;
        /** Pizza Mafia rank tier (e.g. "Made Man"). null when not yet ranked. */
        mafiaRank: { rank: number; tier: string } | null;
        /** Inbound vouches (people who have vouched for this profile). */
        vouchInCount: number;
    };
    about: {
        skills: string;
        orgs: string;
        turtles: string[];
        xAccount: { connected: boolean; username?: string } | null;
    };
    crewIds: string[];
    crewOptions: CrewOption[];
    viewerId: string | null;
    isOwner: boolean;
}

// ---------------------------------------------------------------------------
// Sensitive fields stripped before serving — mirrors /api/profile/[id]:98-105.
// Exported so the vitest suite can assert parity.
// ---------------------------------------------------------------------------

export const SENSITIVE_SHEET_KEYS = [
    "discordid",
    "discord",
    "telegram",
    "email",
    "wallet",
    "address",
] as const;

// ---------------------------------------------------------------------------
// In-memory cache. Keyed by `${id}:${viewerKey}` because isOwner/viewerId
// depend on the caller. 5 min TTL — short, public payload.
// ---------------------------------------------------------------------------

interface CacheEntry { time: number; data: ProfileSummary }
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
    try {
        return await p;
    } catch {
        return fallback;
    }
}

function strField(p: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
        const v = p[k];
        if (typeof v === "string" && v.trim() !== "") return v;
        if (typeof v === "number") return String(v);
    }
    return "";
}

function parseCrews(raw: unknown): string[] {
    const s = String(raw ?? "").trim();
    if (!s || s.toLowerCase() === "none") return [];
    return s.split(",").map((c) => c.trim()).filter(Boolean);
}

function parseTurtles(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return (raw as unknown[]).map((s) => String(s).trim()).filter(Boolean);
    }
    return String(raw ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
}

/**
 * Resolve a profile-picture URL the same way /api/pfp/[memberId] does, but
 * without going through HTTP. Mirrors dashboard-summary's inline pfp logic.
 */
async function resolvePfpUrl(memberId: string): Promise<string | null> {
    try {
        const fs = await import("fs");
        const path = await import("path");
        const pfpDir = path.join(process.cwd(), "public", "pfp");
        const jpg = path.join(pfpDir, `${memberId}.jpg`);
        const png = path.join(pfpDir, `${memberId}.png`);
        if (fs.existsSync(jpg)) return `/pfp/${memberId}.jpg`;
        if (fs.existsSync(png)) return `/pfp/${memberId}.png`;
        const dJpg = path.join(pfpDir, "default.jpg");
        const dPng = path.join(pfpDir, "default.png");
        if (fs.existsSync(dJpg)) return `/pfp/default.jpg`;
        if (fs.existsSync(dPng)) return `/pfp/default.png`;
        return null;
    } catch {
        return null;
    }
}

/**
 * Build the public-safe view of the member row, dropping any sensitive sheet
 * columns. The keys we never want to leak into the BFF payload:
 *
 *   discordid, discord, telegram, email, wallet, address
 *
 * This is identical to /api/profile/[id]:98-105. We DON'T return the raw
 * member-row object from this endpoint — we only project specific fields out
 * — but stripping defensively here means a future drive-by addition of more
 * sheet fields can't accidentally leak them.
 */
function publicMemberView(member: Record<string, unknown> | null): Record<string, unknown> {
    if (!member) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(member)) {
        if (SENSITIVE_SHEET_KEYS.includes(k.toLowerCase() as typeof SENSITIVE_SHEET_KEYS[number])) {
            continue;
        }
        out[k] = v;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Composer — used by GET and exported for vitest. Pure async function over
// the repository layer; no Next request/response concerns.
// ---------------------------------------------------------------------------

export interface ComposeOptions {
    memberId: string;
    viewerMemberId: string | null;
}

export async function composeProfileSummary(
    opts: ComposeOptions
): Promise<ProfileSummary | null> {
    const { memberId, viewerMemberId } = opts;

    const member = await safe(fetchMemberById(memberId), null);
    if (!member) return null;

    const memberDiscordId = String(member.discordId || "").trim();

    // Pull supplementary data in parallel.
    const [pfpUrl, mission, mafia, vouchCounts, xRow, crewMappings, dbTagline] = await Promise.all([
        safe(resolvePfpUrl(memberId), null as string | null),
        memberDiscordId
            ? safe(getUserProgressSummary(memberDiscordId), null as Awaited<
                ReturnType<typeof getUserProgressSummary>
            > | null)
            : Promise.resolve(null),
        safe(getMafiaRank(memberId), null as Awaited<ReturnType<typeof getMafiaRank>> | null),
        safe(getVouchCounts(memberId), {
            total: 0,
            pizzadao: 0,
            farcaster: 0,
            twitter: 0,
            followers: 0,
        }),
        safe(
            (prisma as unknown as {
                xAccount: {
                    findFirst: (args: unknown) => Promise<{ xUsername: string } | null>;
                };
            }).xAccount.findFirst({
                where: { memberId },
                select: { xUsername: true },
            }),
            null as { xUsername: string } | null
        ),
        safe(getCrewMappings(), { crews: [] as CrewOption[], cached: false }),
        // PR4 — tagline from MemberProfileExtras (Postgres). Wins over the
        // sheet read below when present.
        safe(getMemberTagline(memberId), null as string | null),
    ]);

    const publicMember = publicMemberView(member);

    const name = strField(publicMember, "Name", "Mafia Name") || "Anonymous Pizza Maker";
    const city = strField(publicMember, "City") || "Worldwide";
    // Tagline resolution: Postgres `MemberProfileExtras.tagline` (PR4) wins,
    // then the deprecated sheet `Tagline` column, then empty string. This is
    // the migration path the plan calls for in §6.3 / PR3 notes — sheet
    // column will be removed once all live taglines are in Postgres.
    const sheetTagline = strField(publicMember, "Tagline");
    const tagline = (dbTagline && dbTagline.trim()) || sheetTagline || "";
    const orgs = strField(publicMember, "Affiliation", "Orgs");
    const skills = strField(publicMember, "Specialties", "Skills");

    const turtles = parseTurtles(publicMember["Turtles"] ?? publicMember["Roles"] ?? []);
    const crewIds = parseCrews(publicMember["Crews"]);

    // Level: only surface when there's actual approved progress, matching the
    // pre-PR3 client-side rule.
    let level: number | string | null = null;
    let levelTitle = "";
    if (
        mission &&
        typeof mission.currentLevel === "number" &&
        (mission.approvedCount ?? 0) > 0
    ) {
        level = mission.currentLevel > 8 ? "MAX" : mission.currentLevel;
        levelTitle = mission.levelTitle ?? "";
    }

    // Mafia rank: surface the tier name + the level (we don't have a numeric
    // rank id today, but expose `rank` for forward-compat with the plan's
    // typed shape — derive from minPoints which is monotonic across tiers).
    let mafiaRank: { rank: number; tier: string } | null = null;
    if (mafia && mafia.rank && mafia.rank.name) {
        mafiaRank = { rank: mafia.rank.minPoints, tier: mafia.rank.name };
    }

    const xAccount: ProfileSummary["about"]["xAccount"] = xRow
        ? { connected: true, username: xRow.xUsername }
        : { connected: false };

    const isOwner = !!viewerMemberId && viewerMemberId === memberId;

    return {
        hero: {
            name,
            pfpUrl,
            tagline,
            city,
            level,
            levelTitle,
            mafiaRank,
            vouchInCount: vouchCounts.followers ?? 0,
        },
        about: {
            skills,
            orgs,
            turtles,
            xAccount,
        },
        crewIds,
        crewOptions: crewMappings.crews,
        viewerId: viewerMemberId,
        isOwner,
    };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
        }

        // Resolve viewer from cookie — best effort, never blocks the response.
        let viewerMemberId: string | null = null;
        try {
            const session = await getSession();
            if (session?.discordId) {
                viewerMemberId = await safe(
                    fetchMemberIdByDiscordId(session.discordId),
                    null
                );
            }
        } catch {
            viewerMemberId = null;
        }

        const cacheKey = `${id}:${viewerMemberId ?? "anon"}`;
        const cached = CACHE.get(cacheKey);
        const cacheHeaders = {
            "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
        };

        if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
            return NextResponse.json(cached.data, { headers: cacheHeaders });
        }

        const summary = await composeProfileSummary({
            memberId: id,
            viewerMemberId,
        });

        if (!summary) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // Bound cache growth.
        if (CACHE.size > CACHE_MAX) {
            const oldest = Array.from(CACHE.entries()).sort(
                (a, b) => a[1].time - b[1].time
            )[0]?.[0];
            if (oldest) CACHE.delete(oldest);
        }
        CACHE.set(cacheKey, { time: Date.now(), data: summary });

        return NextResponse.json(summary, { headers: cacheHeaders });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Failed to load profile summary";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
