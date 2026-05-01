"use client";

import { useQuery } from "@tanstack/react-query";

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

export function useSession() {
  return useQuery<SessionData>({
    queryKey: ["session"],
    queryFn: async () => {
      const res = await fetch("/api/session");
      if (res.status === 401) {
        return {
          authenticated: false,
          discordId: "",
          memberId: null,
          memberName: null,
          pfpUrl: null,
          crews: [],
          isAdmin: false,
        };
      }
      if (!res.ok) throw new Error("Session fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  });
}
