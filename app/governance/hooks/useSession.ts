'use client'

import { useState, useEffect } from 'react'

interface Session {
  authenticated: boolean
  discordId?: string
  username?: string
  nick?: string
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch('/api/me')
        const data = await res.json()
        setSession(data)
      } catch {
        setSession({ authenticated: false })
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [])

  const login = () => {
    window.location.href = '/api/discord/login?state=/governance'
  }

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    setSession({ authenticated: false })
    window.location.reload()
  }

  return {
    session,
    loading,
    authenticated: session?.authenticated ?? false,
    discordId: session?.discordId,
    username: session?.username,
    nick: session?.nick,
    login,
    logout,
  }
}
