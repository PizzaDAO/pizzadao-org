import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PostFilters, type PostFiltersLabels } from './PostFilters'

const labels = new Proxy({}, { get: (_t, k) => String(k) }) as unknown as PostFiltersLabels
const initial = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] }

function serve(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

beforeEach(() => vi.unstubAllGlobals())

describe('PostFilters', () => {
  it('warns that the old table copy is stale when the mirror failed', async () => {
    serve({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], mirrored: false })
    render(<PostFilters initial={initial} labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(await screen.findByText('mirrorWarning')).toBeTruthy()
  })

  it('shows no warning when the mirror worked', async () => {
    serve({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], mirrored: true })
    render(<PostFilters initial={initial} labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy())
    expect(screen.queryByText('mirrorWarning')).toBeNull()
  })
})
