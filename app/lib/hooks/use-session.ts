"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { knownLoggedOut, markHintLoggedOut } from "@/app/lib/auth-hint";

export interface SessionData {
  authenticated: boolean;
  discordId: string;
  username?: string;
  nick?: string;
  memberId: string | null;
  memberName: string | null;
  pfpUrl: string | null;
  crews: string[];
  isAdmin: boolean;
  /** May review mission submissions (admins + DPR / Pizza Capo / Pepperoni Mafia). */
  canReviewMissions?: boolean;
  /** May manage the $PEP shop at /admin/shop (admins + Pepperoni Mafia). */
  canManageShop?: boolean;
  /** Disavow list: only present while the feature flag is on (server-computed). */
  canViewDisavow?: boolean;
  canVoteDisavow?: boolean;
  /** Already-localized nav label, sent only to eligible viewers. */
  disavowNavLabel?: string;
  /** Proposals nav entry: present (true) only while voting or the proposal history is on. */
  showProposals?: boolean;
  /** Sessions nav entry: present (true) only while the public /learn page is on. */
  showSessions?: boolean;
  /** Call review nav entry: present (true) only while capo review is on and the viewer is a capo or the owner. */
  canReviewCalls?: boolean;
}

export const LOGGED_OUT_SESSION: SessionData = {
  authenticated: false,
  discordId: "",
  memberId: null,
  memberName: null,
  pfpUrl: null,
  crews: [],
  isAdmin: false,
  canReviewMissions: false,
  canManageShop: false,
};

/**
 * Call after POST /api/logout. Writes a logged-out session into the cache
 * (rather than removing it, which makes mounted observers refetch and 401)
 * so session-gated pollers like NotificationBell stop immediately and the
 * header flips to Log in / Join.
 */
export function markLoggedOut(queryClient: QueryClient) {
  queryClient.setQueryData<SessionData>(["session"], LOGGED_OUT_SESSION);
  queryClient.removeQueries({ queryKey: ["me"] });
}

function loggedOutFrom(body: { showProposals?: boolean }): SessionData {
  return body.showProposals === true ? { ...LOGGED_OUT_SESSION, showProposals: true } : LOGGED_OUT_SESSION;
}

/**
 * When the hint cookie says there is no session ("0"), skip /api/session and use the CDN-cacheable
 * /api/session/public. Unknown or "1" always does the real check; a stale "1" gets a 401 and flips to "0".
 */
export async function fetchSession(): Promise<SessionData> {
  if (knownLoggedOut()) {
    const pub = await fetch("/api/session/public").catch(() => null);
    if (pub?.ok) {
      return loggedOutFrom((await pub.json().catch(() => ({}))) as { showProposals?: boolean });
    }
    // The public endpoint failed: fall through to the real check.
  }
  const res = await fetch("/api/session");
  if (res.status === 401) {
    markHintLoggedOut();
    return loggedOutFrom((await res.json().catch(() => ({}))) as { showProposals?: boolean });
  }
  if (!res.ok) throw new Error("Session fetch failed");
  return res.json();
}

export function useSession() {
  return useQuery<SessionData>({
    queryKey: ["session"],
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
}
