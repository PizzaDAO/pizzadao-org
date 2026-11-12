// @vitest-environment jsdom
// The vote sender mounted in the root layout: sends due queued votes on any page; pagehide only near the close.
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { GlobalBallotPreparer } from './GlobalBallotPreparer'

vi.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> })) // eslint-disable-line @typescript-eslint/no-explicit-any

const id = 'abcdefgh12345678'
const voteCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).endsWith('/vote'))
const seed = (sendAt: number, closesAt: number | null) => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(`pizzadao:proposal-ballot:${id}`, JSON.stringify({ token: `proposal-${id}-x`, preparedMessage: 'p', signature: 's' }))
  localStorage.setItem('pizzadao:proposal-vote-queue', JSON.stringify([{ id, choice: 'AYE', sendAt, closesAt }]))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the vote sender (random delay)', () => {
  it('sends a due queued vote when the app mounts, on any page', async () => {
    seed(Date.now() - 1000, Date.now() + 86_400_000)
    const f = vi.fn(async (u: unknown) => (String(u).endsWith('/vote') ? { ok: true, status: 200 } : { ok: false, status: 401 }))
    vi.stubGlobal('fetch', f)
    renderWithIntl(<GlobalBallotPreparer />)
    await waitFor(() => expect(voteCalls(f)).toHaveLength(1))
    await waitFor(() => expect(localStorage.getItem('pizzadao:proposal-vote-queue')).toBe('[]'))
  })

  it('does not send a vote that is not due yet', async () => {
    seed(Date.now() + 600_000, Date.now() + 86_400_000)
    const f = vi.fn(async () => ({ ok: false, status: 401 }))
    vi.stubGlobal('fetch', f)
    renderWithIntl(<GlobalBallotPreparer />)
    await new Promise((r) => setTimeout(r, 30))
    expect(voteCalls(f)).toHaveLength(0)
  })

  it('on pagehide sends (keepalive) when the close is within 30 minutes', async () => {
    seed(Date.now() + 600_000, Date.now() + 10 * 60_000)
    const f = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', f)
    renderWithIntl(<GlobalBallotPreparer />)
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(voteCalls(f)).toHaveLength(1))
    expect((voteCalls(f)[0][1] as RequestInit).keepalive).toBe(true)
  })
})
