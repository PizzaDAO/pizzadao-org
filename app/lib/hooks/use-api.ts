'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

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

// ============ Profile Summary (BFF aggregator) ============

/**
 * Public shape of the /api/profile-summary/[id] response. Mirrors the
 * `ProfileSummary` interface declared in the route handler — kept in sync
 * by tests in `app/api/profile-summary/[id]/__tests__/route.test.ts`.
 *
 * Plan: plans/truffle-91035-profile-redesign.md §6.3 — PR3 (capricciosa-16483).
 */
export interface ProfileSummaryData {
  hero: {
    name: string
    pfpUrl: string | null
    tagline: string
    city: string
    level: number | string | null
    levelTitle: string
    mafiaRank: { rank: number; tier: string } | null
    vouchInCount: number
  }
  about: {
    skills: string
    orgs: string
    turtles: string[]
    xAccount: { connected: boolean; username?: string } | null
  }
  crewIds: string[]
  crewOptions: unknown[]
  viewerId: string | null
  isOwner: boolean
}

/**
 * Profile-summary aggregator hook — Plan: truffle-91035 (PR3 — capricciosa-16483).
 *
 * Single network round-trip via `/api/profile-summary/[id]`. The endpoint
 * composes profile sheet read + pfp + X account + mission progress + mafia
 * rank + vouch counts + crew mappings server-side, replacing the ~8
 * concurrent client fetches that PR2 did via composition.
 *
 * External shape is identical to the PR2 hook so the profile page composition
 * is untouched.
 */
export function useProfileSummary(memberId: string | undefined) {
  return useQuery<ProfileSummaryData>({
    queryKey: ['profile-summary', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/profile-summary/${memberId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to load profile')
      }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  })
}

// ============ Profile Extras (Tagline) ============
//
// Appended at the end of the file (per plan note in PR4 — burrata-13316) to
// minimize merge friction with sibling profile/dashboard PRs.

export interface ProfileExtras {
  tagline: string | null
}

/**
 * Read the member's editable profile-extras row (tagline only for now).
 * Public — anyone can read; owner-only writes go through `useUpdateTagline`.
 */
export function useProfileExtras(memberId: string | undefined) {
  return useQuery<ProfileExtras>({
    queryKey: ['profile-extras', memberId],
    queryFn: async () => {
      const res = await fetch(`/api/profile-extras/${memberId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to load profile extras')
      }
      return res.json()
    },
    enabled: !!memberId,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  })
}

/**
 * Owner-only tagline write. Optimistically updates the profile-extras +
 * profile-summary caches so the hero re-renders without waiting for a
 * round-trip.
 */
export function useUpdateTagline(memberId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<ProfileExtras, Error, string>({
    mutationFn: async (tagline: string) => {
      const res = await fetch(`/api/profile-extras/${memberId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagline }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to save tagline')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.setQueryData(['profile-extras', memberId], data)
      // Patch the cached profile-summary so the hero updates immediately.
      qc.setQueryData<ProfileSummaryData | undefined>(
        ['profile-summary', memberId],
        (prev) =>
          prev
            ? { ...prev, hero: { ...prev.hero, tagline: data.tagline ?? '' } }
            : prev,
      )
    },
  })
}

// ============ Discover (Dashboard PR4 — diavola-58369) ============

/**
 * Shape of the data fed to the `<Discover />` component on /dashboard/[id].
 * Mirrors the item types declared in
 * `app/dashboard/[id]/components/Discover.tsx`. Each list is already capped at
 * 3 items by this hook so the component can render them as-is.
 *
 * Plan: plans/garlic-96648-dashboard-redesign.md §4 + §7 (PR4).
 */
export interface DiscoverData {
  bounties: Array<{
    id: number
    description: string
    reward: number
    status: 'OPEN' | 'CLAIMED'
  }>
  jobs: Array<{
    id: number
    description: string
    crew?: string | null
    completed?: boolean
  }>
  articles: Array<{
    id: number
    slug: string
    title: string
    authorName?: string | null
    publishedAt?: string | null
  }>
  calls: Array<{
    crewId: string
    crewLabel: string
    date: string
  }>
}

/**
 * Fetches the "Discover" preview lists for /dashboard/[id]. Calls each
 * upstream endpoint in parallel, tolerates per-source failures (a single 500
 * does not collapse the section — the failing tab just falls back to an
 * empty state), and slices the result to 3 items per category.
 *
 * The `/api/articles` endpoint accepts a `limit` query param; `/api/calls`
 * does too. `/api/bounties` and `/api/jobs` don't paginate server-side, so
 * the hook fetches the full list and slices client-side.
 */
export function useDiscover() {
  return useQuery<DiscoverData>({
    queryKey: ['discover'],
    queryFn: async () => {
      type RawArticle = {
        id: number
        slug: string
        title: string
        authorName?: string | null
        publishedAt?: string | null
      }
      type RawCall = { crewId: string; crewLabel: string; date: string }

      const safeJson = async <T,>(p: Promise<Response>, fallback: T): Promise<T> => {
        try {
          const res = await p
          if (!res.ok) return fallback
          return (await res.json()) as T
        } catch {
          return fallback
        }
      }

      const [bountiesRes, jobsRes, articlesRes, callsRes] = await Promise.all([
        safeJson<{ bounties?: DiscoverData['bounties'] }>(
          fetch('/api/bounties'),
          {},
        ),
        safeJson<{ jobs?: Array<{ id: number; description: string; type?: string; completed?: boolean }> }>(
          fetch('/api/jobs'),
          {},
        ),
        safeJson<{ articles?: RawArticle[] }>(
          fetch('/api/articles?limit=3'),
          {},
        ),
        safeJson<{ calls?: RawCall[] }>(
          fetch('/api/calls?limit=3&sort=newest'),
          {},
        ),
      ])

      const bounties: DiscoverData['bounties'] = (bountiesRes.bounties ?? [])
        .filter((b) => b.status === 'OPEN')
        .slice(0, 3)
        .map((b) => ({
          id: b.id,
          description: b.description,
          reward: b.reward,
          status: b.status,
        }))

      const jobs: DiscoverData['jobs'] = (jobsRes.jobs ?? [])
        .slice(0, 3)
        .map((j) => ({
          id: j.id,
          description: j.description,
          crew: j.type ?? null,
          completed: j.completed,
        }))

      const articles: DiscoverData['articles'] = (articlesRes.articles ?? [])
        .slice(0, 3)
        .map((a) => ({
          id: a.id,
          slug: a.slug,
          title: a.title,
          authorName: a.authorName ?? null,
          publishedAt: a.publishedAt ?? null,
        }))

      const calls: DiscoverData['calls'] = (callsRes.calls ?? [])
        .slice(0, 3)
        .map((c) => ({
          crewId: c.crewId,
          crewLabel: c.crewLabel,
          date: c.date,
        }))

      return { bounties, jobs, articles, calls }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
}
