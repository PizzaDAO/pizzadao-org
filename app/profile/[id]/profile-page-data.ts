// Server-side data for /profile/[id]: the hero fallback and the above-the-fold prefill.
// Kept out of page.tsx (a page file may only export the page and its metadata) so it can be tested.
//
// Privacy: everything prefilled here is viewer-independent public data, EXCEPT the passport, which
// depends on who is looking. The passport is therefore prefilled only for a request without a
// session cookie (the anonymous view); anyone with a cookie fetches it on the client as before.

import type { ProfileSummary } from "@/app/api/profile-summary/[id]/route";
import { withDeadline } from "@/app/api/profile-summary/[id]/route";
import { GET as attendanceGET } from "@/app/api/attendance/[memberId]/route";
import { GET as articlesGET } from "@/app/api/articles/by-member/[memberId]/route";
import { GET as passportGET } from "@/app/api/passport/[memberId]/route";
import { GET as vouchesGET } from "@/app/api/vouches/route";
import { GET as vouchersGET } from "@/app/api/vouches/vouchers/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import { withoutNonCrewIds } from "@/app/lib/crew-id";

/** The whole page waits at most this long for the full summary before painting from the light data. */
export const PROFILE_PAGE_BUDGET_MS = 1200;
/** Each prefilled section waits at most this long (they run in parallel); on timeout the client fetches it. */
export const PREFILL_BUDGET_MS = 300;

export interface ProfilePrefill {
    articles: { articles: unknown[] } | null;
    vouches: { vouches?: unknown[]; counts?: { total?: number } } | null;
    vouchers: { enabled?: boolean; total?: number; vouchers?: unknown[] } | null;
    attendance: unknown | null;
    /** Anonymous view only; null otherwise (the client then fetches its own, viewer-aware copy). */
    passport: unknown | null;
}

const withParams = (memberId: string) => ({ params: Promise.resolve({ memberId }) });

/** Load the above-the-fold sections in parallel, each capped, each null on failure or timeout. */
export async function loadProfilePrefill(memberId: string, opts: { anonymous: boolean }): Promise<ProfilePrefill> {
    const cap = async <T,>(p: Promise<T | null>): Promise<T | null> => (await withDeadline(p, PREFILL_BUDGET_MS, null)).value;
    const enc = encodeURIComponent(memberId);
    const [articles, vouches, vouchers, attendance, passport] = await Promise.all([
        cap(prefetchRoute<ProfilePrefill["articles"] & object>(articlesGET, `/api/articles/by-member/${enc}`, withParams(memberId))),
        cap(prefetchRoute<ProfilePrefill["vouches"] & object>(vouchesGET, `/api/vouches?memberId=${enc}&limit=5`)),
        cap(prefetchRoute<ProfilePrefill["vouchers"] & object>(vouchersGET, `/api/vouches/vouchers?memberId=${enc}`)),
        cap(prefetchRoute<object>(attendanceGET, `/api/attendance/${enc}`, withParams(memberId))),
        opts.anonymous ? cap(prefetchRoute<object>(passportGET, `/api/passport/${enc}`, withParams(memberId))) : Promise.resolve(null),
    ]);
    return { articles, vouches, vouchers, attendance, passport };
}

/**
 * A summary for the first paint built from the light compose (name, pfp, tagline, city, about,
 * crews). Level, rank, member-since, vouches, Discord activity and the X account are unknown, so
 * they are left empty and `partial` makes the client refetch the full summary. The crew ids are
 * filtered with no registry loaded: the Community Call pseudo-crew is still dropped (static ids).
 */
export function partialSummaryFromLight(light: ProfileSummary): ProfileSummary {
    return {
        hero: { ...light.hero, level: null, levelTitle: "", levelCompleted: null, levelCompletedTitle: "", mafiaRank: null, vouchInCount: 0, memberSince: null },
        about: { ...light.about, xAccount: null },
        discordActivity: null,
        crewIds: withoutNonCrewIds(light.crewIds, []),
        crewOptions: [],
        viewerId: null,
        isOwner: false,
        partial: true,
    };
}
