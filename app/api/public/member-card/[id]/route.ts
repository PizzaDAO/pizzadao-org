// GET /api/public/member-card/[id] — the small public payload behind the profile hover card.
//
// Public fields ONLY, assembled field by field from an allow-list (never by spreading a member
// row): id, name, pfp, level, mafia rank tier and crew labels. No Discord id, wallet, email,
// Telegram or any other contact field. Cached in memory and at the CDN for 5 minutes.

import { NextRequest, NextResponse, after } from "next/server";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { withoutNonCrewIds } from "@/app/lib/crew-id";
import { resolveMemberSince, monthPrecisionIso } from "@/app/lib/member-since";
import { getPublicDiscordActivity, type PublicDiscordActivity } from "@/app/lib/discord-activity-public";
import { resolvePfpUrlAsync } from "@/app/lib/pfp";

export const runtime = "nodejs";

export interface MemberCard {
    memberId: string;
    name: string;
    pfpUrl: string | null;
    /** 1..8, "MAX" past the top level, or null when there is no approved progress yet. */
    level: number | string | null;
    levelTitle: string;
    /** Highest level COMPLETED (what badges show); 0 when none yet, null when unknown. */
    levelCompleted: number | null;
    levelCompletedTitle: string;
    mafiaRank: string | null;
    crews: { id: string; label: string; emoji?: string }[];
    /** ISO date for "member since" (earliest of Discord join, first call, site signup), or null. */
    memberSince: string | null;
    /** Public Discord activity (month-precision dates, public channels only); null when off or no data. */
    discordActivity: PublicDiscordActivity | null;
}

/** Exactly these keys may appear in the response. Asserted in the tests. */
export const MEMBER_CARD_KEYS = ["memberId", "name", "pfpUrl", "level", "levelTitle", "levelCompleted", "levelCompletedTitle", "mafiaRank", "crews", "memberSince", "discordActivity"] as const;

export const MEMBER_CARD_CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
} as const;

/** The cold mafia rank can take seconds; the card renders without it past this. */
const RANK_BUDGET_MS = 800;

const CACHE = new Map<string, { time: number; data: MemberCard }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
    try {
        return await p;
    } catch {
        return fallback;
    }
}

function text(v: unknown): string {
    return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([p.catch(() => fallback), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

export async function composeMemberCard(memberId: string): Promise<MemberCard | null> {
    const member = await safe(fetchMemberById(memberId), null);
    if (!member) return null;
    const m = member as unknown as Record<string, unknown>;

    const discordId = text(m["discordId"]);
    // Past the budget the lookup keeps running (and fills its cache) after the response is sent.
    const rankPromise = getMafiaRank(memberId);
    try {
        after(() => rankPromise.then(() => undefined, () => undefined));
    } catch {
        // outside a request scope (tests): nothing to extend
    }
    // Same pattern as the rank: past the budget the lookup keeps running so its write lands.
    const sincePromise = resolveMemberSince(memberId, discordId || null);
    try {
        after(() => sincePromise.then(() => undefined, () => undefined));
    } catch {
        // outside a request scope (tests)
    }
    const [pfpUrl, mission, rank, crewMappings, since, discordActivity] = await Promise.all([
        safe(resolvePfpUrlAsync(memberId), null as string | null),
        discordId ? safe(getUserProgressSummary(discordId), null) : Promise.resolve(null),
        withBudget(rankPromise, RANK_BUDGET_MS, null),
        safe(getCrewMappings(), { crews: [], cached: false }),
        withBudget(sincePromise, RANK_BUDGET_MS, null as Date | null),
        withBudget(getPublicDiscordActivity(discordId || null), RANK_BUDGET_MS, null as PublicDiscordActivity | null),
    ]);

    let level: MemberCard["level"] = null;
    let levelTitle = "";
    let levelCompleted: MemberCard["levelCompleted"] = null;
    let levelCompletedTitle = "";
    if (mission && typeof mission.currentLevel === "number" && (mission.approvedCount ?? 0) > 0) {
        const maxLevel = typeof mission.maxLevel === "number" && mission.maxLevel > 0 ? mission.maxLevel : 8;
        level = mission.currentLevel > maxLevel ? "MAX" : mission.currentLevel;
        levelTitle = mission.levelTitle ?? "";
    }
    // Level 0 (nothing completed) still shows: the badge is the highest level completed.
    if (mission && typeof mission.completed === "number") {
        levelCompleted = mission.completed;
        levelCompletedTitle = mission.completedTitle ?? "";
    }

    const crewIds = withoutNonCrewIds(
        text(m["Crews"])
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c && c.toLowerCase() !== "none"),
        crewMappings.crews ?? [],
    );
    const byId = new Map((crewMappings.crews ?? []).map((c) => [c.id, c] as const));
    const crews = crewIds.map((id) => {
        const c = byId.get(id);
        return { id, label: c?.label || id, ...(c?.emoji ? { emoji: c.emoji } : {}) };
    });

    return {
        memberId,
        name: text(m["Name"]) || text(m["Mafia Name"]) || "Anonymous Pizza Maker",
        pfpUrl,
        level,
        levelTitle,
        levelCompleted,
        levelCompletedTitle,
        mafiaRank: rank?.rank?.name ?? null,
        crews,
        memberSince: monthPrecisionIso(since),
        discordActivity,
    };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!id) return NextResponse.json({ error: "Missing member ID" }, { status: 400 });

        const hit = CACHE.get(id);
        let card: MemberCard | null;
        if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
            card = hit.data;
        } else {
            card = await composeMemberCard(id);
            if (card) {
                if (CACHE.size > CACHE_MAX) {
                    const oldest = [...CACHE.entries()].sort((a, b) => a[1].time - b[1].time)[0]?.[0];
                    if (oldest) CACHE.delete(oldest);
                }
                CACHE.set(id, { time: Date.now(), data: card });
            }
        }
        if (!card) {
            return NextResponse.json({ error: "Member not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
        }
        return NextResponse.json(card, { headers: MEMBER_CARD_CACHE_HEADERS });
    } catch {
        return NextResponse.json({ error: "Failed to load member card" }, { status: 500 });
    }
}
