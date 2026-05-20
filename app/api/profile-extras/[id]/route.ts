// app/api/profile-extras/[id]/route.ts
//
// Member-owned profile extras (tagline today; more fields later).
//
// GET — public. Returns `{ tagline: string | null }`. Reads from
//   MemberProfileExtras keyed by memberId; returns `{ tagline: null }` when
//   no row exists.
//
// POST — owner-only. Verifies the viewer's session resolves to the same
//   memberId as `params.id`; 403 otherwise. Body: `{ tagline: string }`.
//   Validates trim + max-140 chars and upserts. Returns the saved value.
//
// Auth pattern mirrors /api/dashboard-summary (session.discordId →
// fetchMemberIdByDiscordId → equality check against the requested memberId).
//
// Plan: plans/truffle-91035-profile-redesign.md §6.3 — PR4 (burrata-13316).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

// 140 chars matches the DB VARCHAR(140) constraint set in the migration.
export const TAGLINE_MAX_LEN = 140;

// Shape of MemberProfileExtras Prisma model — kept loose because the model
// is new and some type/generator combos may lag.
interface ExtrasModel {
    findUnique: (args: {
        where: { memberId: string };
        select?: Record<string, boolean>;
    }) => Promise<{ tagline: string | null } | null>;
    upsert: (args: {
        where: { memberId: string };
        create: { memberId: string; tagline: string | null };
        update: { tagline: string | null };
        select: { tagline: boolean };
    }) => Promise<{ tagline: string | null }>;
}

function extrasClient(): ExtrasModel {
    return (
        prisma as unknown as { memberProfileExtras: ExtrasModel }
    ).memberProfileExtras;
}

// ---------------------------------------------------------------------------
// Composer — pulled out so /api/profile-summary can call it directly.
// Returns the persisted tagline value (or null when no row yet).
// ---------------------------------------------------------------------------

export async function getMemberTagline(memberId: string): Promise<string | null> {
    if (!memberId) return null;
    try {
        const row = await extrasClient().findUnique({
            where: { memberId },
            select: { tagline: true },
        });
        return row?.tagline ?? null;
    } catch {
        // If the table doesn't exist yet (e.g. preview branch without the
        // migration applied), don't fail upstream callers — degrade to null.
        return null;
    }
}

// ---------------------------------------------------------------------------
// GET — public
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
        const tagline = await getMemberTagline(id);
        return NextResponse.json(
            { tagline },
            {
                headers: {
                    // Short cache — tagline edits should appear quickly.
                    "Cache-Control":
                        "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
                },
            }
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// ---------------------------------------------------------------------------
// POST — owner-only
// ---------------------------------------------------------------------------

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
        }

        // --- Auth: session → memberId equality ---
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json(
                { error: "Not authenticated" },
                { status: 401 }
            );
        }
        const viewerMemberId = await fetchMemberIdByDiscordId(session.discordId).catch(
            () => null
        );
        if (!viewerMemberId || viewerMemberId !== id) {
            return NextResponse.json(
                { error: "Forbidden: only the profile owner can edit" },
                { status: 403 }
            );
        }

        // --- Body parse + validate ---
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid body" }, { status: 400 });
        }

        const rawTagline = (body as { tagline?: unknown }).tagline;
        if (typeof rawTagline !== "string") {
            return NextResponse.json(
                { error: "tagline must be a string" },
                { status: 400 }
            );
        }

        const trimmed = rawTagline.trim();
        if (trimmed.length > TAGLINE_MAX_LEN) {
            return NextResponse.json(
                {
                    error: `tagline must be ${TAGLINE_MAX_LEN} characters or fewer`,
                },
                { status: 400 }
            );
        }
        // Persist null when empty so /profile/[id] OG falls through to the
        // default description.
        const value: string | null = trimmed.length === 0 ? null : trimmed;

        const saved = await extrasClient().upsert({
            where: { memberId: id },
            create: { memberId: id, tagline: value },
            update: { tagline: value },
            select: { tagline: true },
        });

        return NextResponse.json({ tagline: saved.tagline });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
