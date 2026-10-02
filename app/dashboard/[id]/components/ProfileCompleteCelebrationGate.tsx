// app/dashboard/[id]/components/ProfileCompleteCelebrationGate.tsx
//
// jalapeno-34126 — Decides whether to show the one-time profile-complete
// celebration on the dashboard.
//
// Flow, once the summary says the profile is 100% complete:
//   1. Skip if this browser already knows it was celebrated (localStorage
//      memo — saves a request on every later dashboard visit).
//   2. POST /api/missions/celebration { profileCompleted: true }. The server
//      atomically flips MemberProfileExtras.profileCompletedCelebratedAt from
//      null → now() and returns `profileCompletedClaimed: true` only for the
//      request that flipped it. Members grandfathered by the migration
//      backfill (already complete at deploy) always get `false`.
//   3. Show the overlay only when claimed — so it fires once per member,
//      across tabs, devices and reloads.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ProfileCompleteCelebration } from "../../../ui/profile/ProfileCompleteCelebration";
import type { ProfileCompletion } from "../lib/profile-completion";

const memoKey = (memberId: string) => `pizzadao:profile-complete-celebrated:${memberId}`;

function readMemo(memberId: string): boolean {
    try {
        return window.localStorage.getItem(memoKey(memberId)) === "1";
    } catch {
        return false;
    }
}

function writeMemo(memberId: string) {
    try {
        window.localStorage.setItem(memoKey(memberId), "1");
    } catch {
        /* private mode etc. — the server flag is the real gate */
    }
}

export function ProfileCompleteCelebrationGate({
    memberId,
    completion,
}: {
    memberId: string;
    completion: ProfileCompletion | null | undefined;
}) {
    const [open, setOpen] = useState(false);
    const tSteps = useTranslations("dashboard.steps");
    const attempted = useRef(false);
    const isComplete = !!completion?.isComplete;

    useEffect(() => {
        if (!isComplete || !memberId || attempted.current) return;
        attempted.current = true;
        if (readMemo(memberId)) return;

        // No "cancelled" flag on purpose: under StrictMode the effect's first
        // run is torn down immediately, and the `attempted` ref blocks the
        // re-run — the claim must still be able to open the overlay.
        (async () => {
            try {
                const res = await fetch("/api/missions/celebration", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profileCompleted: true }),
                });
                if (!res.ok) return; // non-essential; try again next visit
                const body = (await res.json().catch(() => ({}))) as {
                    profileCompletedClaimed?: boolean;
                    profileCompletedCelebratedAt?: string | null;
                };
                if (body.profileCompletedClaimed || body.profileCompletedCelebratedAt) {
                    writeMemo(memberId);
                }
                if (body.profileCompletedClaimed) setOpen(true);
            } catch {
                /* silent — celebration is non-essential */
            }
        })();
    }, [isComplete, memberId]);

    const handleDismiss = useCallback(() => setOpen(false), []);

    if (!open || !completion) return null;
    return (
        <ProfileCompleteCelebration
            stepLabels={completion.steps.map((s) => tSteps(`${s.key}.label`))}
            profileHref={`/profile/${memberId}`}
            onDismiss={handleDismiss}
        />
    );
}
