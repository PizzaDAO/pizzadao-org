// Crew drafts section: member-only rendering, X intent links, thread split.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { CrewDrafts } from './CrewDrafts'
import { xIntentUrl } from '@/app/lib/draft-text'

const draft = (over: Record<string, unknown>) => ({
  id: 1, platform: 'x', text: 'gm #pizza & friends', mediaUrl: null, notes: null, status: 'ready',
  createdBy: 'u', postedAt: null, postedUrl: null, ...over,
})

function mockFetch(ok: boolean, access: { member: boolean; manager: boolean }, drafts: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => ({ access, drafts }) })))
}

afterEach(() => vi.unstubAllGlobals())

describe('CrewDrafts', () => {
  it('renders nothing for non-members', async () => {
    mockFetch(false, { member: false, manager: false }, [])
    const { container } = renderWithIntl(<CrewDrafts crewId="comms" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="crew-drafts"]')).toBeNull()
  })

  it('links Post on X to the encoded intent URL; only managers see Mark posted', async () => {
    mockFetch(true, { member: true, manager: false }, [draft({})])
    const { unmount } = renderWithIntl(<CrewDrafts crewId="comms" />)
    const link = await screen.findByRole('link', { name: 'Post on X' })
    expect(link.getAttribute('href')).toBe(xIntentUrl('gm #pizza & friends'))
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.queryByText('Mark posted')).toBeNull()
    unmount()

    mockFetch(true, { member: true, manager: true }, [draft({})])
    renderWithIntl(<CrewDrafts crewId="comms" />)
    expect(await screen.findByText('Mark posted')).toBeTruthy()
    expect(screen.getByText('Archive')).toBeTruthy()
  })

  it('shows a numbered thread for long X drafts', async () => {
    const long = Array.from({ length: 20 }, (_, i) => `Sentence ${i} is about pizza.`).join(' ')
    mockFetch(true, { member: true, manager: false }, [draft({ text: long })])
    renderWithIntl(<CrewDrafts crewId="comms" />)
    expect(await screen.findByText(/Thread \(\d+ parts\)/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Post \d+ on X/ }).length).toBeGreaterThan(1)
  })
})
