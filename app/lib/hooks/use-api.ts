'use client'

import { useQuery } from '@tanstack/react-query'

// ============ Auth ============

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('Not authenticated')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,  // 5 min
    retry: false,
  })
}

// ============ Profile ============

export function useProfile(memberId: string | undefined) {
  return useQuery({
    queryKey: ['profile', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/profile/${memberId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load profile')
      }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePfp(memberId: string | undefined) {
  return useQuery({
    queryKey: ['pfp', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/pfp/${memberId}`)
      if (!res.ok) return { url: null }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ User Data (Dashboard - auth-protected) ============

export function useUserData(memberId: string | undefined) {
  return useQuery({
    queryKey: ['user-data', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/user-data/${memberId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (res.status === 401) throw new Error('__AUTH_401__')
        if (res.status === 403) throw new Error('__AUTH_403__')
        throw new Error(err.error || 'Failed to load dashboard')
      }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

// ============ Crew ============

export function useCrewMappings() {
  return useQuery({
    queryKey: ['crew-mappings'],
    queryFn: async () => {
      const res = await fetch('/api/crew-mappings')
      if (!res.ok) throw new Error('Failed to load crew mappings')
      return res.json()
    },
    staleTime: 10 * 60 * 1000, // 10 min - shared across ALL pages
  })
}

export function useCrewMembers() {
  return useQuery({
    queryKey: ['crew-members'],
    queryFn: async () => {
      const res = await fetch('/api/crew/members')
      if (!res.ok) throw new Error('Failed to load crew members')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
  })
}

// ============ Tasks ============

export function useMyTasks(memberId: string | undefined) {
  return useQuery({
    queryKey: ['my-tasks', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/my-tasks/${memberId}`)
      if (!res.ok) return { tasksByCrew: {}, doneCountsByCrew: {} }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
  })
}

// ============ NFTs & POAPs ============

export function useNFTs(memberId: string | undefined) {
  return useQuery({
    queryKey: ['nfts', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/nfts/${memberId}`)
      if (!res.ok) return { nfts: [] }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

export function usePOAPs(memberId: string | undefined) {
  return useQuery({
    queryKey: ['poaps', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/poaps/${memberId}`)
      if (!res.ok) return { poaps: [] }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ Vouches ============

export function useVouches(memberId: string | undefined, options?: { limit?: number; source?: string }) {
  return useQuery({
    queryKey: ['vouches', memberId, options],
    queryFn: async () => {
      const params = new URLSearchParams({ memberId: memberId! })
      if (options?.limit) params.set('limit', String(options.limit))
      if (options?.source) params.set('source', options.source)
      const res = await fetch(`/api/vouches?${params}`)
      if (!res.ok) throw new Error('Failed to load vouches')
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60 * 1000, // 1 min
  })
}

export function useVouchCounts(memberId: string | undefined) {
  return useQuery({
    queryKey: ['vouch-counts', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/vouches/count?memberId=${memberId}`)
      if (!res.ok) return { total: 0 }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60 * 1000,
  })
}

// ============ Economy ============

export function useEconomyBalance(memberId: string | undefined) {
  return useQuery({
    queryKey: ['economy-balance', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/economy/balance?memberId=${memberId}`)
      if (!res.ok) return { balance: 0 }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60 * 1000,
  })
}

/** Balance for the current session user (no memberId param needed) */
export function useMyBalance() {
  return useQuery({
    queryKey: ['my-balance'],
    queryFn: async () => {
      const res = await fetch('/api/economy/balance')
      if (!res.ok) return { balance: 0 }
      return res.json()
    },
    staleTime: 60 * 1000,
  })
}

export function useEconomyLeaderboard() {
  return useQuery({
    queryKey: ['economy-leaderboard'],
    queryFn: async () => {
      const res = await fetch('/api/economy/leaderboard')
      if (!res.ok) throw new Error('Failed to load leaderboard')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ============ Missions ============

export function useMissions() {
  return useQuery({
    queryKey: ['missions'],
    queryFn: async () => {
      const res = await fetch('/api/missions')
      if (!res.ok) throw new Error('Failed to load missions')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useMissionProgress(memberId: string | undefined) {
  return useQuery({
    queryKey: ['mission-progress', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/missions/progress/by-member/${memberId}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
  })
}

// ============ Attendance ============

export function useAttendance(memberId: string | undefined) {
  return useQuery({
    queryKey: ['attendance', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${memberId}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}

// ============ Articles ============

export function useArticlesByMember(memberId: string | undefined) {
  return useQuery({
    queryKey: ['articles-by-member', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/articles/by-member/${memberId}`)
      if (!res.ok) return { articles: [] }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ X Account ============

export function useXAccount(memberId: string | undefined) {
  return useQuery({
    queryKey: ['x-account', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/x/account/${memberId}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ Social Accounts ============

export function useSocialAccounts(memberId: string | undefined) {
  return useQuery({
    queryKey: ['social-accounts', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/social-accounts?memberId=${memberId}`)
      if (!res.ok) return { accounts: [] }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ Bounties ============

export function useBounties() {
  return useQuery({
    queryKey: ['bounties'],
    queryFn: async () => {
      const res = await fetch('/api/bounties')
      if (!res.ok) throw new Error('Failed to load bounties')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

// ============ Mafia Points ============

export function useMafiaPoints(memberId: string | undefined) {
  return useQuery({
    queryKey: ['mafia-points', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/mafia-points/${memberId}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 30 * 60 * 1000,
  })
}

// ============ Member Lookup ============

export function useMemberLookup(discordId: string | undefined) {
  return useQuery({
    queryKey: ['member-lookup', discordId],
    queryFn: async () => {
      const res = await fetch(`/api/member-lookup/${discordId}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled: !!discordId,
    staleTime: 10 * 60 * 1000,
  })
}

// ============ Dashboard Summary (BFF) ============

/**
 * Fetch the consolidated dashboard payload from /api/dashboard-summary.
 * Replaces the ~8 concurrent client fetches the dashboard previously did
 * (user-data, missions, balance, my-tasks, vouches, wallets, x, notifications).
 *
 * Plan: plans/garlic-96648-dashboard-redesign.md §6.3
 */
export function useDashboardSummary(memberId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard-summary', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard-summary?memberId=${encodeURIComponent(memberId!)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load dashboard summary')
      }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  })
}

// ============ Activity Feed ============

/**
 * Recent-activity feed for the dashboard. Backs the `RecentActivity`
 * component on /dashboard/[id]. Aggregated server-side over Prisma sources
 * (vouches, mission completions, unlock tickets, notifications); the page
 * surfaces the top 5 of the returned (max 20) events.
 *
 * Plan: plans/garlic-96648-dashboard-redesign.md §6.3, PR3.
 */
export function useActivity(memberId: string | undefined) {
  return useQuery({
    queryKey: ['activity', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/activity/${memberId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load activity')
      }
      return res.json() as Promise<{ events: import('../../dashboard/[id]/lib/activity-types').ActivityEvent[] }>
    },
    enabled: !!memberId,
    staleTime: 30 * 1000,
    retry: false,
  })
}

// ============ Profile Summary (composed, client-side) ============

/**
 * Profile-summary aggregator hook — Plan: truffle-91035 (PR2 — pepperoni-77692).
 *
 * Client-side composition over existing hooks. The PR3 follow-up replaces
 * the inner fetches with a single `/api/profile-summary/[id]` BFF endpoint;
 * this hook's external shape is the contract the page consumes, so the
 * swap is a one-file change.
 *
 * Returns null `data` until the core `useProfile` finishes (loading or
 * error). The supplementary hooks (pfp, x, articles, mission progress,
 * me, crew mappings) degrade gracefully — missing data leaves fields
 * blank rather than blocking the page.
 */
export function useProfileSummary(memberId: string | undefined) {
  const profile = useProfile(memberId)
  const pfp = usePfp(memberId)
  const x = useXAccount(memberId)
  const mission = useMissionProgress(memberId)
  const me = useMe()
  const crewMappings = useCrewMappings()

  const data = (() => {
    if (!profile.data) return null
    const p: Record<string, unknown> = profile.data
    const get = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')

    const name =
      get('Name') || get('Mafia Name') || 'Anonymous Pizza Maker'
    const city = get('City') || 'Worldwide'
    const crewsStr = get('Crews') || 'None'
    const orgs = get('Affiliation') || get('Orgs') || ''
    const skills = get('Specialties') || get('Skills') || ''
    const tagline = get('Tagline') || ''

    const rawTurtles = p['Turtles'] ?? p['Roles'] ?? []
    const turtleList = (Array.isArray(rawTurtles)
      ? (rawTurtles as unknown[]).map((s) => String(s).trim())
      : String(rawTurtles).split(',').map((t) => t.trim())
    ).filter(Boolean)

    const crewIds = crewsStr !== 'None'
      ? crewsStr.split(',').map((c) => c.trim()).filter(Boolean)
      : []

    const mp = mission.data as
      | { currentLevel?: number; approvedCount?: number; levelTitle?: string }
      | null
      | undefined
    let level: number | string | null = null
    let levelTitle = ''
    if (mp && typeof mp.currentLevel === 'number' && (mp.approvedCount ?? 0) > 0) {
      level = mp.currentLevel > 8 ? 'MAX' : mp.currentLevel
      levelTitle = mp.levelTitle ?? ''
    }

    const viewerId: string | null =
      (me.data && typeof me.data === 'object' && 'memberId' in (me.data as Record<string, unknown>)
        ? ((me.data as { memberId?: string | null }).memberId ?? null)
        : null)

    return {
      hero: {
        name,
        pfpUrl: (pfp.data as { url?: string | null } | undefined)?.url ?? null,
        tagline,
        city,
        level,
        levelTitle,
      },
      about: {
        skills,
        orgs,
        turtles: turtleList,
        xAccount: (x.data as { connected?: boolean; username?: string } | null | undefined) ?? null,
      },
      crewIds,
      crewOptions: ((crewMappings.data as { crews?: unknown[] } | undefined)?.crews ?? []) as unknown[],
      viewerId,
      isOwner: !!viewerId && String(viewerId) === String(memberId),
    }
  })()

  return {
    data,
    isLoading: profile.isLoading,
    error: profile.error,
  }
}
