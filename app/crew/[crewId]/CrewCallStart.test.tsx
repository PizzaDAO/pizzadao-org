// Start crew call button: hidden without permission, start flow, refusal copy, preview note.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { CrewCallStart } from './CrewCallStart'

function mockFetch(get: unknown, post?: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: (post?.status ?? 200) < 400, status: post?.status ?? 200, json: async () => post?.body ?? {} }
        : { ok: true, status: 200, json: async () => get },
    ),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('CrewCallStart', () => {
  it('renders nothing when the member may not start the call (or the switch is off)', async () => {
    mockFetch({ canStart: false })
    const { container } = renderWithIntl(<CrewCallStart crewId="ops" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('button')).toBeNull()
  })

  it('starts the call and shows the live state with a join link', async () => {
    mockFetch({ canStart: true, state: 'idle', voiceUrl: null }, { status: 200, body: { status: 'started', voiceUrl: 'https://discord.com/channels/1/2' } })
    renderWithIntl(<CrewCallStart crewId="ops" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start crew call' }))
    expect(await screen.findByText('Live')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Join voice' }).getAttribute('href')).toBe('https://discord.com/channels/1/2')
    expect(screen.queryByRole('button', { name: 'Start crew call' })).toBeNull()
  })

  it('shows the refusal when another crew is live', async () => {
    mockFetch({ canStart: true, state: 'idle' }, { status: 409, body: { status: 'channel_busy' } })
    renderWithIntl(<CrewCallStart crewId="ops" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start crew call' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Another crew is live in the call channel now.')).toBeTruthy()
  })

  it('disables the button while another crew holds the channel', async () => {
    mockFetch({ canStart: true, state: 'busy', otherCrewLabel: 'Tech' })
    renderWithIntl(<CrewCallStart crewId="ops" />)
    const button = (await screen.findByRole('button', { name: 'Start crew call' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Tech is live in the call channel now.')).toBeTruthy()
  })

  it('says nothing was started on a preview deploy', async () => {
    mockFetch({ canStart: true, state: 'idle' }, { status: 200, body: { status: 'preview' } })
    renderWithIntl(<CrewCallStart crewId="ops" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start crew call' }))
    expect(await screen.findByText('Preview: nothing was started.')).toBeTruthy()
  })
})
