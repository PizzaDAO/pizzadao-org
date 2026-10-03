"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

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
}

export const LOGGED_OUT_SESSION: SessionData = {
  authenticated: false,
  discordId: "",
  memberId: null,
  memberName: null,
  pfpUrl: null,
  crews: [],
  isAdmin: false,
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

export function useSession() {
  return useQuery<SessionData>({
    queryKey: ["session"],
    queryFn: async () => {
      const res = await fetch("/api/session");
      if (res.status === 401) return LOGGED_OUT_SESSION;
      if (!res.ok) throw new Error("Session fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
}
