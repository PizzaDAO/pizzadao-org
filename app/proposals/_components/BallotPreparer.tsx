"use client";

import { useEffect } from "react";
import { prepareBallot } from "@/app/lib/proposals/client";

/**
 * Silently gets this browser a blind-signed ballot token for each proposal it is eligible for and has no token
 * for yet. Runs when the list or a proposal page LOADS, long before anyone votes, so the token request and the
 * later vote request cannot be tied together by timing. Renders nothing.
 */
export function BallotPreparer({ ids }: { ids: string[] }) {
    const key = ids.join(",");
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const id of key ? key.split(",") : []) {
                if (cancelled) return;
                try {
                    await prepareBallot(id);
                } catch {
                    /* the vote panel shows its own retry message */
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [key]);
    return null;
}
