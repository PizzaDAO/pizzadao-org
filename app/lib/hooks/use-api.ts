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
