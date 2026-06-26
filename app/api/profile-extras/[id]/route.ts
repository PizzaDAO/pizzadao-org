// app/api/profile-extras/[id]/route.ts
//
// Member-owned profile extras. Currently:
//   - `tagline` — one-line public bio (truffle-91035 / burrata-13316).
//   - `locale`  — i18n preference (anchovy-65959).
//
// GET — public. Returns `{ tagline: string | null, locale: SupportedLocale }`.
//   When no row exists yet, returns `{ tagline: null, locale: 'en' }`.
//
// POST — owner-only. Verifies the viewer's session resolves to the same
//   memberId as `params.id`; 403 otherwise. Body accepts any subset of:
//     { tagline?: string, locale?: SupportedLocale }
//   When `locale` is included, the response also sets the NEXT_LOCALE cookie
//   so the new language takes effect on the very next navigation.
//
// Auth pattern mirrors /api/dashboard-summary (session.discordId →
// fetchMemberIdByDiscordId → equality check against the requested memberId).
//
// Plans: plans/truffle-91035-profile-redesign.md §6.3 (PR4 — burrata-13316);
//        plans/anchovy-65959-i18n.md (locale field).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { prisma } from "@/app/lib/db";
import {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    type SupportedLocale,
    isSupportedLocale,
} from "@/app/lib/i18n/locales";
import { LOCALE_COOKIE } from "@/app/lib/i18n/get-locale";

export const runtime = "nodejs";

// 140 chars matches the DB VARCHAR(140) constraint set in the migration.
export const TAGLINE_MAX_LEN = 140;

type ExtrasRow = {
    tagline: string | null;
    locale: string | null;
};

// Shape of MemberProfileExtras Prisma model — kept loose because the model
// is new and some type/generator combos may lag.
interface ExtrasModel {
    findUnique: (args: {
        where: { memberId: string };
        select?: Record<string, boolean>;
    }) => Promise<ExtrasRow | null>;
    upsert: (args: {
        where: { memberId: string };
        create: Partial<ExtrasRow> & { memberId: string };
        update: Partial<ExtrasRow>;
        select: Record<string, boolean>;
    }) => Promise<ExtrasRow>;
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

/**
 * Returns the persisted locale for a member, falling back to the default
 * when no row exists or the stored value is unrecognized. Safe to call from
 * unauthenticated paths.
 */
export async function getMemberLocale(memberId: string): Promise<SupportedLocale> {
    if (!memberId) return DEFAULT_LOCALE;
    try {
        const row = await extrasClient().findUnique({
            where: { memberId },
            select: { locale: true },
        });
        return isSupportedLocale(row?.locale) ? row!.locale : DEFAULT_LOCALE;
    } catch {
        return DEFAULT_LOCALE;
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
        // Single DB hit fetches both fields.
        let tagline: string | null = null;
        let locale: SupportedLocale = DEFAULT_LOCALE;
        try {
            const row = await extrasClient().findUnique({
                where: { memberId: id },
                select: { tagline: true, locale: true },
            });
            tagline = row?.tagline ?? null;
            locale = isSupportedLocale(row?.locale) ? row!.locale : DEFAULT_LOCALE;
        } catch {
            // Degrade gracefully if the migration hasn't run yet.
        }
        return NextResponse.json(
            { tagline, locale },
            {
                headers: {
                    // Short cache — edits should appear quickly.
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

        const raw = body as { tagline?: unknown; locale?: unknown };
        const hasTagline = Object.prototype.hasOwnProperty.call(raw, "tagline");
        const hasLocale = Object.prototype.hasOwnProperty.call(raw, "locale");

        if (!hasTagline && !hasLocale) {
            return NextResponse.json(
                { error: "Body must include `tagline` and/or `locale`" },
                { status: 400 }
            );
        }

        const create: Partial<ExtrasRow> & { memberId: string } = { memberId: id };
        const update: Partial<ExtrasRow> = {};

        // --- Tagline ---
        if (hasTagline) {
            if (typeof raw.tagline !== "string") {
                return NextResponse.json(
                    { error: "tagline must be a string" },
                    { status: 400 }
                );
            }
            const trimmed = raw.tagline.trim();
            if (trimmed.length > TAGLINE_MAX_LEN) {
                return NextResponse.json(
                    { error: `tagline must be ${TAGLINE_MAX_LEN} characters or fewer` },
                    { status: 400 }
                );
            }
            // Persist null when empty so /profile/[id] OG falls through to the
            // default description.
            const value: string | null = trimmed.length === 0 ? null : trimmed;
            create.tagline = value;
            update.tagline = value;
        }

        // --- Locale ---
        if (hasLocale) {
            if (!isSupportedLocale(raw.locale)) {
                return NextResponse.json(
                    { error: "Unsupported locale", allowed: SUPPORTED_LOCALES },
                    { status: 400 }
                );
            }
            create.locale = raw.locale;
            update.locale = raw.locale;
        }

        const saved = await extrasClient().upsert({
            where: { memberId: id },
            create,
            update,
            select: { tagline: true, locale: true },
        });

        const res = NextResponse.json({
            tagline: saved.tagline,
            locale: isSupportedLocale(saved.locale) ? saved.locale : DEFAULT_LOCALE,
        });

        // Pin the cookie so the user's next navigation uses the new catalog.
        if (hasLocale && isSupportedLocale(saved.locale)) {
            const isSecure =
                process.env.NODE_ENV === "production" ||
                req.headers.get("x-forwarded-proto") === "https";
            res.cookies.set({
                name: LOCALE_COOKIE,
                value: saved.locale,
                httpOnly: false,
                secure: isSecure,
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24 * 365,
            });
        }
        return res;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
