// app/profile/[id]/page.tsx
//
// Plan: truffle-91035 (PR3 — capricciosa-16483).
//
// Server-component wrapper. Its only job is to export generateMetadata so
// /profile/[id] renders rich OpenGraph + Twitter previews when shared into
// Discord / X / Telegram. All interactivity (React Query, ?as=visitor
// handling, owner banner, etc.) lives in <ProfileClient/>.

import type { Metadata } from "next";
import { composeProfileSummary, getPublicProfileSummary, isIncompleteSummary } from "@/app/api/profile-summary/[id]/route";
import { ProfileClient } from "./ProfileClient";
import type { ProfileSummaryData } from "@/app/lib/hooks/use-api";
import { getSession } from "@/app/lib/session";
import { disavowEnabled } from "@/app/lib/disavow/constants";
import { canViewDisavowList } from "@/app/lib/disavow/access";
import { findActiveListingFor } from "@/app/lib/disavow/match";
import { getDisavowTranslator } from "@/app/lib/disavow/messages";
import { getBuddyRecognition } from "@/app/lib/buddy/recognition";
import { BuddyRecognitionBlock } from "@/app/ui/profile/BuddyRecognitionBlock";
import { COOKIE_NAME } from "@/app/lib/session";
import { cache, Suspense } from "react";
import { cookies } from "next/headers";
import { after } from "next/server";
import { DEFAULT_PFP_URL } from "@/app/lib/pfp-default";
import { withDeadline } from "@/app/api/profile-summary/[id]/route";
import { loadProfilePrefill, partialSummaryFromLight, PROFILE_PAGE_BUDGET_MS } from "./profile-page-data";

export const runtime = "nodejs";

// Pull the same in-memory cache the API route uses by calling the composer
// directly. That avoids a self-HTTP round-trip during SSR and keeps the
// metadata path resilient to upstream sheet flakiness.
// React cache(): generateMetadata and the page share one light compose (one member and pfp read) per request.
const loadHero = cache(async (id: string) => {
    try {
        return await composeProfileSummary({ memberId: id, viewerMemberId: null, light: true });
    } catch {
        return null;
    }
});

/** Public buddy recognition, streamed on its own so it never holds up the hero. */
async function BuddySlot({ id }: { id: string }) {
    const recognition = await getBuddyRecognition(id).catch(() => null);
    return recognition ? <BuddyRecognitionBlock recognition={recognition} /> : null;
}

/** Whether the request carries a session cookie at all (unverified; used only to skip viewer-specific prefill). */
async function hasSessionCookie(): Promise<boolean> {
    try {
        return (await cookies()).has(COOKIE_NAME);
    } catch {
        return true; // cannot tell: treat as signed in, so nothing viewer-specific is prefilled
    }
}

function absoluteUrl(pathOrUrl: string | null): string | undefined {
    if (!pathOrUrl) return undefined;
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    const base =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (!base) return pathOrUrl; // relative path is fine for in-app browsers
    return `${base.replace(/\/$/, "")}${pathOrUrl}`;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ id: string }>;
}): Promise<Metadata> {
    const { id } = await params;
    const summary = await loadHero(id);

    if (!summary) {
        return {
            title: "Profile",
            description: "PizzaDAO member profile",
        };
    }

    const name = summary.hero.name || "PizzaDAO member";
    const tagline = summary.hero.tagline?.trim();
    const description = tagline || `${name} · PizzaDAO member`;
    const ogImage = absoluteUrl(summary.hero.pfpUrl ?? DEFAULT_PFP_URL);

    return {
        title: name,
        description,
        openGraph: {
            title: name,
            description,
            type: "profile",
            url: `/profile/${id}`,
            images: ogImage ? [{ url: ogImage, alt: `${name}'s profile picture` }] : undefined,
        },
        twitter: {
            card: "summary_large_image",
            title: name,
            description,
            images: ogImage ? [ogImage] : undefined,
        },
    };
}

export default async function ProfilePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    // Everything starts at once. The full public summary (shared cache, then compose) gets an
    // overall budget; past it the hero paints from the light data generateMetadata already loaded
    // and the client completes it. Buddy recognition streams separately (Suspense).
    const full = getPublicProfileSummary(id).catch(() => null);
    const hasSession = await hasSessionCookie();
    // Above-the-fold sections ride along with the HTML (each capped; the client fetches any that miss).
    const [summaryResult, disavowWarning, prefill] = await Promise.all([
        withDeadline(full, PROFILE_PAGE_BUDGET_MS, null),
        loadDisavowWarning(id),
        loadProfilePrefill(id, { anonymous: !hasSession }),
    ]);
    let initialSummary = summaryResult.value;
    // A summary that missed a deadline (rank, member-since, Discord activity) is not final: mark it
    // partial so the client refetches at once instead of treating it as fresh.
    if (initialSummary && isIncompleteSummary(initialSummary)) initialSummary = { ...initialSummary, partial: true };
    if (summaryResult.timedOut) after(() => full.then(() => undefined, () => undefined));
    if (!initialSummary) {
        const light = await loadHero(id);
        if (light) initialSummary = partialSummaryFromLight(light);
    }
    return (
        <ProfileClient
            id={id}
            disavowWarning={disavowWarning}
            buddySlot={
                <Suspense fallback={null}>
                    <BuddySlot id={id} />
                </Suspense>
            }
            initialSummary={initialSummary as unknown as ProfileSummaryData | null}
            prefill={prefill}
        />
    );
}

/**
 * Private disavow warning (plans/disavow-list.md). Does nothing, and does not
 * even read the session, while the disavow feature is off. Only an eligible viewer
 * ever gets a non-null value; everyone else's page is unchanged.
 */
async function loadDisavowWarning(memberId: string): Promise<{ id: string; label: string } | null> {
    if (!(await disavowEnabled())) return null;
    try {
        const session = await getSession();
        if (!session?.discordId) return null;
        if (!(await canViewDisavowList(session.discordId))) return null;
        const hit = await findActiveListingFor(memberId);
        if (!hit) return null;
        // Translated here, for this viewer only (disavow text is not in the root catalog).
        return { id: hit.id, label: (await getDisavowTranslator())("chip.label") };
    } catch {
        return null;
    }
}
