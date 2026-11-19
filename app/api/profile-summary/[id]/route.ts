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
import { fetchMemberById, fetchMemberIdByDiscordId, type MemberSheetData } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getVouchCounts } from "@/app/lib/vouches";
import { getCrewMappings, type CrewOption } from "@/app/lib/crew-mappings";
import { realCrews, withoutNonCrewIds } from "@/app/lib/crew-id";
import { prisma } from "@/app/lib/db";
import { getMemberTagline } from "@/app/api/profile-extras/[id]/route";
import { resolvePfpUrlAsync } from "@/app/lib/pfp";
import { DEFAULT_PFP_URL } from "@/app/lib/pfp-default";
import { resolveMemberSince, monthPrecisionIso } from "@/app/lib/member-since";
import { getPublicDiscordActivity, type PublicDiscordActivity } from "@/app/lib/discord-activity-public";
import { internalError } from "@/app/lib/errors/error-response";
import { unstable_cache } from "next/cache";
import {
    PROFILE_L1_MAX,
    PROFILE_L1_TTL_MS,
    PROFILE_MEMBERS_TAG,
    PROFILE_SUMMARY_REVALIDATE_SECONDS,
    profileL1,
    profileTag,
} from "@/app/lib/profile-summary-cache";

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
        /** Highest level COMPLETED (display badge); 0 when none yet, null when unknown. `level` is the one being worked on. */
        levelCompleted: number | null;
        levelCompletedTitle: string;
        /** Pizza Mafia rank tier (e.g. "Made Man"). null when not yet ranked. */
        mafiaRank: { rank: number; tier: string } | null;
        /** Inbound vouches (people who have vouched for this profile). */
        vouchInCount: number;
        /** ISO date shown as "member since": the earliest of Discord join, first call and site signup. */
        memberSince: string | null;
    };
    about: {
        skills: string;
        orgs: string;
        turtles: string[];
        xAccount: { connected: boolean; username?: string } | null;
    };
    /** Public Discord activity (month-precision dates, public channels only); null when off or no data. */
    discordActivity: PublicDiscordActivity | null;
    crewIds: string[];
    crewOptions: CrewOption[];
    viewerId: string | null;
    isOwner: boolean;
    /**
     * Set only by the profile page when it painted from the light data because the full summary
     * was still composing: the client then refetches to fill in level, rank, member-since and
     * Discord activity. Never set by the composer and never cached.
     */
    partial?: boolean;
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
// Caching: see getPublicProfileSummary (L1 memory + shared unstable_cache, viewer-independent only).
// ---------------------------------------------------------------------------

// The response depends on the caller's session (isOwner / viewerId), so browsers and the CDN must
// not cache it: a copy cached while signed out kept showing "Sign in to vouch" after login.
export const PROFILE_SUMMARY_CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// The per-instance L1 (profileL1) and the shared data-cache settings live in app/lib/profile-summary-cache.ts.

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
    /**
     * Inputs read by the caller. composeViaSharedCache reads the member row and crew mappings
     * OUTSIDE unstable_cache and passes them in, because the loaders behind them have their own
     * cache and Next skips (or forces no-store on) a cache nested inside another one.
     */
    inputs?: { member: MemberSheetData | null; crewMappings: { crews: CrewOption[]; cached: boolean } };
}

/** How long the profile waits for a cold mafia rank (Discord + Alchemy + POAP calls, ~4s). */
export const MAFIA_RANK_BUDGET_MS = 1200;

/** How long the profile waits for the public Discord activity block (channel names come from Discord). */
export const DISCORD_ACTIVITY_BUDGET_MS = 500;

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

/** Set when the summary was composed without a lookup that missed its deadline (rank, member-since, Discord activity). */
const INCOMPLETE = new WeakSet<ProfileSummary>();

/** True for a summary composed with a missed deadline: not cached, and the client must refetch it. */
export function isIncompleteSummary(s: ProfileSummary | null | undefined): boolean {
    return !!s && INCOMPLETE.has(s);
}

export async function composeProfileSummary(
    opts: ComposeOptions
): Promise<ProfileSummary | null> {
    const { memberId, viewerMemberId, light = false, inputs } = opts;
    const keep = keepAlive;

    // Everything below except mission progress is keyed by memberId alone, so it starts now,
    // alongside the member read, instead of waiting for it.
    const memberPromise = inputs ? Promise.resolve(inputs.member) : safe(fetchMemberById(memberId), null);

    // Pull supplementary data in parallel. The cold mafia rank is the slow one, so it gets a
    // deadline: past it the profile renders without the badge and the lookup finishes in the
    // background (it caches its result), so the next load has it.
    // Display only: the earliest known date. Chained off the member read so it runs alongside the
    // other lookups, and capped so a cold Discord lookup never holds the profile up.
    const sincePromise: Promise<Date | null> = light
        ? Promise.resolve(null)
        : memberPromise.then((m) =>
            m ? resolveMemberSince(memberId, String(m.discordId || "").trim() || null) : null,
        ).catch(() => null);
    const activityPromise: Promise<PublicDiscordActivity | null> = light
        ? Promise.resolve(null)
        : memberPromise.then((m) => (m ? getPublicDiscordActivity(String(m.discordId || "").trim() || null) : null)).catch(() => null);
    const sinceDeadline = withDeadline(sincePromise, 800, null as Date | null);
    const activityDeadline = withDeadline(activityPromise, DISCORD_ACTIVITY_BUDGET_MS, null as PublicDiscordActivity | null);
    const mafiaPromise = light
        ? Promise.resolve(null)
        : getMafiaRank(memberId).then(
            (r) => r,
            () => null as Awaited<ReturnType<typeof getMafiaRank>> | null,
        );
    const [pfpUrl, mission, mafiaResult, vouchCounts, xRow, crewMappings, dbTagline] = await Promise.all([
        safe(resolvePfpUrlAsync(memberId), DEFAULT_PFP_URL as string),
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
            : inputs
            ? Promise.resolve(inputs.crewMappings)
            : safe(getCrewMappings(false, { staleWhileRevalidate: true }), { crews: [] as CrewOption[], cached: false }),
        // PR4 — tagline from MemberProfileExtras (Postgres). Wins over the
        // sheet read below when present.
        safe(getMemberTagline(memberId), null as string | null),
    ]);
    const [member, sinceResult, activityResult] = await Promise.all([memberPromise, sinceDeadline, activityDeadline]);
    const discordActivity = activityResult.value;
    if (!member) return null;
    const memberSince = sinceResult.value;
    if (sinceResult.timedOut) keep(sincePromise);
    const mafia = mafiaResult.value;
    if (mafiaResult.timedOut) keep(mafiaPromise);
    if (activityResult.timedOut) keep(activityPromise);

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
    // The profile lists crews only; the Community Call is not one.
    const crewIds = withoutNonCrewIds(parseCrews(publicMember["Crews"]), crewMappings.crews);

    // Level: only surface when there's actual approved progress, matching the
    // pre-PR3 client-side rule.
    let level: number | string | null = null;
    let levelTitle = "";
    let levelCompleted: number | null = null;
    let levelCompletedTitle = "";
    if (
        mission &&
        typeof mission.currentLevel === "number" &&
        (mission.approvedCount ?? 0) > 0
    ) {
        const maxLevel = typeof mission.maxLevel === "number" && mission.maxLevel > 0 ? mission.maxLevel : 8;
        level = mission.currentLevel > maxLevel ? "MAX" : mission.currentLevel;
        levelTitle = mission.levelTitle ?? "";
    }
    // Level 0 (nothing completed) still shows: the badge is the highest level completed.
    if (mission && typeof mission.completed === "number") {
        levelCompleted = mission.completed;
        levelCompletedTitle = mission.completedTitle ?? "";
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
            levelCompleted,
            levelCompletedTitle,
            mafiaRank,
            vouchInCount: vouchCounts.followers ?? 0,
            memberSince: monthPrecisionIso(memberSince),
        },
        about: {
            skills,
            orgs,
            turtles,
            xAccount,
        },
        discordActivity,
        crewIds,
        crewOptions: realCrews(crewMappings.crews),
        viewerId: viewerMemberId,
        isOwner,
    };
    if (mafiaResult.timedOut || sinceResult.timedOut || activityResult.timedOut) {
        INCOMPLETE.add(summary);
    }
    return summary;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/** Thrown inside the cached function so an incomplete (or missing) summary is returned but never stored. */
class NotCacheable extends Error {
    constructor(readonly summary: ProfileSummary | null) {
        super("profile summary not cacheable");
    }
}

/**
 * Compose through Next's shared data cache. Only a COMPLETE summary is stored: when the compose
 * missed a deadline (INCOMPLETE) or the member does not exist, the value is carried out of a
 * sentinel error, which unstable_cache does not store, and returned to the caller.
 * Cache key ["profile-summary-v1", id]; tags "members" and `profile:<id>`; revalidate 300 s.
 *
 * The member row and crew mappings are read here, outside the cached callback: their loaders use
 * unstable_cache / cached fetches themselves, and Next skips a cache nested in another (every miss
 * would run a full member table query) and forces no-store on cached fetches inside one. The
 * callback therefore only composes from what it is given. `after()` works inside it, so lookups
 * that missed their deadline are kept alive by the compose itself.
 *
 * Background revalidation of a stale entry: if that compose is incomplete, throwing would make
 * Next log a revalidation failure, so the callback returns the stale value that was just served
 * instead (it was complete; only deadline-missed extras differ) and the entry is simply re-stored.
 */
async function composeViaSharedCache(id: string): Promise<ProfileSummary | null> {
    const member = await safe(fetchMemberById(id), null);
    if (!member) return null; // missing member: never cached
    const crewMappings = await safe(getCrewMappings(false, { staleWhileRevalidate: true }), {
        crews: [] as CrewOption[],
        cached: false,
    });
    let ran = false;
    let served: ProfileSummary | null = null;
    let carried: { summary: ProfileSummary | null } | null = null;
    const cached = unstable_cache(
        async (): Promise<ProfileSummary> => {
            ran = true;
            const base = await composeProfileSummary({ memberId: id, viewerMemberId: null, inputs: { member, crewMappings } });
            if (!base) {
                carried = { summary: base };
                throw new NotCacheable(base);
            }
            if (INCOMPLETE.has(base)) {
                // A revalidation that runs after the stale value was served: keep serving it, quietly.
                if (served) return served;
                carried = { summary: base };
                throw new NotCacheable(base);
            }
            return base;
        },
        ["profile-summary-v1", id],
        { revalidate: PROFILE_SUMMARY_REVALIDATE_SECONDS, tags: [PROFILE_MEMBERS_TAG, profileTag(id)] },
    );
    try {
        const value = await cached();
        served = value;
        return value;
    } catch (err) {
        const out: { summary: ProfileSummary | null } | null =
            carried ?? (err instanceof NotCacheable ? { summary: err.summary } : null);
        if (out) return out.summary;
        // The compose itself failed: surface it. Otherwise the data cache is unavailable here
        // (scripts, tests): compose directly.
        if (ran) throw err;
        return composeProfileSummary({ memberId: id, viewerMemberId: null, inputs: { member, crewMappings } });
    }
}

/**
 * The viewer-independent summary: memory L1 (30 s), then the shared data cache (5 min, tagged
 * `members` and `profile:<id>`), then a compose. Shared by the API route and the profile page,
 * which prefills it on the server. Null when the member does not exist. Never holds anything
 * viewer-specific (isOwner / viewerId are applied by the caller).
 */
export async function getPublicProfileSummary(id: string): Promise<ProfileSummary | null> {
    const l1 = profileL1.get(id);
    if (l1 && Date.now() - l1.time < PROFILE_L1_TTL_MS) return l1.data as ProfileSummary;
    const base = await composeViaSharedCache(id);
    if (base && !INCOMPLETE.has(base)) {
        // Bound cache growth.
        if (profileL1.size > PROFILE_L1_MAX) {
            const oldest = Array.from(profileL1.entries()).sort((a, b) => a[1].time - b[1].time)[0]?.[0];
            if (oldest) profileL1.delete(oldest);
        }
        profileL1.set(id, { time: Date.now(), data: base });
    }
    return base;
}

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

        const base = await getPublicProfileSummary(id);

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
