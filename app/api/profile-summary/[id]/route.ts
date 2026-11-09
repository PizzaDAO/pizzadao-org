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

import { NextRequest, NextResponse, after } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberById, fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getVouchCounts } from "@/app/lib/vouches";
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { prisma } from "@/app/lib/db";
import { getMemberTagline } from "@/app/api/profile-extras/[id]/route";
import { resolvePfpUrlAsync } from "@/app/lib/pfp";
import { internalError } from "@/app/lib/errors/error-response";

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

// The response depends on the caller's session (isOwner / viewerId), so browsers and the CDN must
// not cache it: a copy cached while signed out kept showing "Sign in to vouch" after login.
export const PROFILE_SUMMARY_CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

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
    /**
     * Only the fields link previews need (name, pfp, tagline): skips mission progress, mafia
     * rank, vouches, X account and crew mappings. Used by generateMetadata, which must not wait
     * on the slow lookups.
     */
    light?: boolean;
}

/** How long the profile waits for a cold mafia rank (Discord + Alchemy + POAP calls, ~4s). */
export const MAFIA_RANK_BUDGET_MS = 1200;

const NO_VOUCHES = { total: 0, pizzadao: 0, farcaster: 0, twitter: 0, followers: 0, pizzadaoFollowers: 0 };

/**
 * Resolve `p`, or `fallback` once `ms` passes. The underlying promise keeps running (and
 * warming its own cache); `timedOut` tells the caller the fallback was used. Never rejects.
 */
export async function withDeadline<T>(
    p: Promise<T>,
    ms: number,
    fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
    });
    const work = p.then(
        (value) => ({ value, timedOut: false }),
        () => ({ value: fallback, timedOut: false }),
    );
    try {
        return await Promise.race([work, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Keep a still-running lookup alive after the response is sent so it can fill its cache. */
function keepAlive(p: Promise<unknown>) {
    try {
        after(() => p.then(() => undefined, () => undefined));
    } catch {
        // Outside a request scope (tests, scripts): nothing to extend.
    }
}

/** Set when the summary was composed without a mafia rank because it was still computing. */
const INCOMPLETE = new WeakSet<ProfileSummary>();

export async function composeProfileSummary(
    opts: ComposeOptions
): Promise<ProfileSummary | null> {
    const { memberId, viewerMemberId, light = false } = opts;

    // Everything below except mission progress is keyed by memberId alone, so it starts now,
    // alongside the member read, instead of waiting for it.
    const memberPromise = safe(fetchMemberById(memberId), null);

    // Pull supplementary data in parallel. The cold mafia rank is the slow one, so it gets a
    // deadline: past it the profile renders without the badge and the lookup finishes in the
    // background (it caches its result), so the next load has it.
    const mafiaPromise = light
        ? Promise.resolve(null)
        : getMafiaRank(memberId).then(
            (r) => r,
            () => null as Awaited<ReturnType<typeof getMafiaRank>> | null,
        );
    const [pfpUrl, mission, mafiaResult, vouchCounts, xRow, crewMappings, dbTagline] = await Promise.all([
        safe(resolvePfpUrlAsync(memberId), null as string | null),
        light
            ? Promise.resolve(null)
            : memberPromise.then((m) => {
                const discordId = String(m?.discordId || "").trim();
                return discordId
                    ? safe(getUserProgressSummary(discordId), null as Awaited<
                        ReturnType<typeof getUserProgressSummary>
                    > | null)
                    : null;
            }),
        withDeadline(mafiaPromise, MAFIA_RANK_BUDGET_MS, null),
        light ? Promise.resolve(NO_VOUCHES) : safe(getVouchCounts(memberId), NO_VOUCHES),
        light
            ? Promise.resolve(null as { xUsername: string } | null)
            : safe(
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
        light
            ? Promise.resolve({ crews: [] as CrewOption[], cached: false })
            : safe(getCrewMappings(), { crews: [] as CrewOption[], cached: false }),
        // PR4 — tagline from MemberProfileExtras (Postgres). Wins over the
        // sheet read below when present.
        safe(getMemberTagline(memberId), null as string | null),
    ]);
    const member = await memberPromise;
    if (!member) return null;
    const mafia = mafiaResult.value;
    if (mafiaResult.timedOut) keepAlive(mafiaPromise);

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
        const maxLevel = typeof mission.maxLevel === "number" && mission.maxLevel > 0 ? mission.maxLevel : 8;
        level = mission.currentLevel > maxLevel ? "MAX" : mission.currentLevel;
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

    const summary: ProfileSummary = {
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
    if (mafiaResult.timedOut) INCOMPLETE.add(summary);
    return summary;
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

        const cacheHeaders = PROFILE_SUMMARY_CACHE_HEADERS;

        // Resolve the viewer (cookie -> member id) while the summary composes: the summary itself
        // does not depend on the viewer, only isOwner / viewerId do, so the cache is keyed by
        // profile id and the viewer is applied afterwards.
        const viewerPromise = (async (): Promise<string | null> => {
            try {
                const session = await getSession();
                if (!session?.discordId) return null;
                return await safe(fetchMemberIdByDiscordId(session.discordId), null);
            } catch {
                return null;
            }
        })();

        let base: ProfileSummary | null;
        const cached = CACHE.get(id);
        if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
            base = cached.data;
        } else {
            base = await composeProfileSummary({ memberId: id, viewerMemberId: null });
            if (base) {
                // Bound cache growth.
                if (CACHE.size > CACHE_MAX) {
                    const oldest = Array.from(CACHE.entries()).sort(
                        (a, b) => a[1].time - b[1].time
                    )[0]?.[0];
                    if (oldest) CACHE.delete(oldest);
                }
                // A summary missing its rank (still computing) is not memoised, so the next load picks it up.
                if (!INCOMPLETE.has(base)) CACHE.set(id, { time: Date.now(), data: base });
            }
        }

        if (!base) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        const viewerMemberId = await viewerPromise;
        const summary: ProfileSummary = {
            ...base,
            viewerId: viewerMemberId,
            isOwner: !!viewerMemberId && viewerMemberId === id,
        };

        return NextResponse.json(summary, { headers: cacheHeaders });
    } catch (error) {
        return internalError(error, "profile-summary", "Failed to load profile summary");
    }
}
