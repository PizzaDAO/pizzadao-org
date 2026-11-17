import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('./profile/MemberHoverCard', () => ({
  MemberHoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { UserLink } from './UserLink'

describe('UserLink', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ found: false }), { status: 404 })) as unknown as typeof fetch
  })

  it('uses a provided name and makes no lookup fetch', () => {
    render(<UserLink discordId="100000000000000021" name="Sample Person" />)
    expect(screen.getByText('Sample Person')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('falls back to "a member", never a truncated id, when the lookup finds nothing', async () => {
    render(<UserLink discordId="100000000000000022" />)
    await waitFor(() => expect(screen.getByText('a member')).toBeInTheDocument())
    expect(screen.queryByText(/10000000/)).toBeNull()
  })
})
