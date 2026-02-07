import React, { Suspense } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import CrewPage from '../[crewId]/page'

// Mock next/font/google - must be before component import is evaluated
vi.mock('next/font/google', () => ({
  Inter: () => ({
    style: { fontFamily: 'Inter, sans-serif' },
    subsets: ['latin'],
  }),
}))

// Mock next/link to render as plain anchor
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// ---- Types matching the component ----

type Task = {
  priority: string
  stage: string
  goal?: string
  task: string
  dueDate?: string
  lead?: string
  leadId?: string
  notes?: string
  url?: string
}

type CrewData = {
  crew: {
    id: string
    label: string
    emoji?: string
    callTime?: string
    callTimeUrl?: string
    callLength?: string
    channel?: string
    role?: string
    sheet?: string
  }
  roster: any[]
  goals: any[]
  tasks: Task[]
  agenda: any[]
  callInfo: null
}

// ---- Test fixtures ----

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    priority: '2. Mid',
    stage: 'todo',
    task: `Task ${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  }
}

const OPEN_TASK_1 = makeTask({ task: 'Design new logo', lead: '', priority: '0. Top' })
const OPEN_TASK_2 = makeTask({ task: 'Write documentation', lead: '#N/A' })
const OPEN_TASK_3 = makeTask({ task: 'Update CI pipeline' }) // no lead field at all
const CLAIMED_TASK_1 = makeTask({ task: 'Fix login bug', lead: 'Alice', leadId: '100' })
const CLAIMED_TASK_2 = makeTask({ task: 'Refactor API', lead: 'Bob', leadId: '200' })
const MY_TASK = makeTask({ task: 'My assigned work', lead: 'TestUser', leadId: '42' })

function buildCrewData(tasks: Task[]): CrewData {
  return {
    crew: { id: 'tech', label: 'Tech Crew', emoji: '', sheet: 'https://docs.google.com/spreadsheets/d/test' },
    roster: [],
    goals: [],
    tasks,
    agenda: [],
    callInfo: null,
  }
}

// ---- Helpers for mocking fetch ----

function mockFetchResponses(crewData: CrewData, user: { memberId: string; name: string } | null = null) {
  ;(global.fetch as Mock).mockImplementation((url: string) => {
    if (url.includes('/api/crew/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(crewData),
      })
    }
    // IMPORTANT: Check more specific URLs BEFORE less specific ones.
    // '/api/member-lookup/' contains '/api/me' as a substring, so it must be checked first.
    if (url.includes('/api/member-lookup/')) {
      if (user) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ memberId: user.memberId, memberName: user.name }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }
    if (url.includes('/api/manuals')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ manuals: [] }),
      })
    }
    if (url.endsWith('/api/me')) {
      if (user) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ authenticated: true, discordId: 'discord-123' }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }
    if (url.includes('/api/profile/')) {
      if (user) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ Name: user.name, Crews: 'tech' }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }
    // Default fallback
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

// Helper to render the crew page with Suspense boundary (needed for React 19 use() hook)
async function renderCrewPage(
  crewData: CrewData,
  user: { memberId: string; name: string } | null = null
) {
  mockFetchResponses(crewData, user)

  // The params promise must be pre-resolved for use() to work synchronously
  // in the test environment. We use a resolved promise.
  const paramsPromise = Promise.resolve({ crewId: 'tech' })

  // Need to let the promise resolve before rendering so use() doesn't suspend
  await act(async () => {
    render(
      <Suspense fallback={<div>Loading...</div>}>
        <CrewPage params={paramsPromise} />
      </Suspense>
    )
  })

  // Wait for data fetch to complete and component to render task content
  // The component first shows a loading spinner, then fetches data and renders
}

// ---- Unit tests for pure filter logic ----

describe('needsLead (filter logic)', () => {
  // Extracted from the component: const needsLead = (t) => !t.lead || t.lead === '#N/A' || t.lead.trim() === ''
  const needsLead = (t: Task) => !t.lead || t.lead === '#N/A' || t.lead.trim() === ''

  it('returns true when lead is empty string', () => {
    expect(needsLead(makeTask({ lead: '' }))).toBe(true)
  })

  it('returns true when lead is undefined', () => {
    expect(needsLead(makeTask({ lead: undefined }))).toBe(true)
  })

  it('returns true when lead is #N/A', () => {
    expect(needsLead(makeTask({ lead: '#N/A' }))).toBe(true)
  })

  it('returns true when lead is whitespace only', () => {
    expect(needsLead(makeTask({ lead: '   ' }))).toBe(true)
  })

  it('returns false when lead has a name', () => {
    expect(needsLead(makeTask({ lead: 'Alice' }))).toBe(false)
  })
})

describe('filterOpen (filter logic)', () => {
  const needsLead = (t: Task) => !t.lead || t.lead === '#N/A' || t.lead.trim() === ''
  const filterOpen = (list: Task[], showOpenOnly: boolean) =>
    showOpenOnly ? list.filter(needsLead) : list

  it('returns all tasks when filter is off', () => {
    const tasks = [OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2]
    expect(filterOpen(tasks, false)).toHaveLength(3)
  })

  it('returns only open tasks when filter is on', () => {
    const tasks = [OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2]
    const result = filterOpen(tasks, true)
    expect(result).toHaveLength(2)
    expect(result).toContain(OPEN_TASK_1)
    expect(result).toContain(OPEN_TASK_2)
  })

  it('returns empty array when all tasks are claimed and filter is on', () => {
    const tasks = [CLAIMED_TASK_1, CLAIMED_TASK_2]
    expect(filterOpen(tasks, true)).toHaveLength(0)
  })
})

// ---- Component integration tests ----

describe('CrewPage open tasks filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the "Show open tasks only" checkbox when open tasks exist', async () => {
    const data = buildCrewData([OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only/)).toBeInTheDocument()
    })

    // The checkbox label should include the count of open tasks
    expect(screen.getByText(/Show open tasks only \(2\)/)).toBeInTheDocument()
  })

  it('hides the checkbox when no open tasks exist (all tasks have leads)', async () => {
    const data = buildCrewData([CLAIMED_TASK_1, CLAIMED_TASK_2])
    await renderCrewPage(data)

    // Wait for the Tasks heading to appear (use getAllByText since "Other Tasks (2)" also matches)
    await waitFor(() => {
      // Find the h2 heading specifically
      const headings = screen.getAllByText(/Tasks \(2\)/)
      expect(headings.length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText(/Show open tasks only/)).not.toBeInTheDocument()
  })

  it('shows heading "Tasks (N)" when filter is inactive', async () => {
    const data = buildCrewData([OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText('Tasks (3)')).toBeInTheDocument()
    })
  })

  it('changes heading to "Tasks (X open / Y total)" when filter is active', async () => {
    const data = buildCrewData([OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only/)).toBeInTheDocument()
    })

    // Click the checkbox to activate filter
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    // Heading should now show open/total format
    expect(screen.getByText('Tasks (2 open / 3 total)')).toBeInTheDocument()
  })

  it('shows only unclaimed tasks when checkbox is checked', async () => {
    const data = buildCrewData([OPEN_TASK_1, CLAIMED_TASK_1, OPEN_TASK_2])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText('Design new logo')).toBeInTheDocument()
    })

    // Before filter: all tasks visible
    // Note: OPEN_TASK_1 has priority '0. Top' so it goes in Top Tasks (expanded by default)
    // CLAIMED_TASK_1 has priority '2. Mid' so it goes in Other Tasks (collapsed by default)
    // OPEN_TASK_2 has priority '2. Mid' so it also goes in Other Tasks
    // We need to expand Other Tasks first to see them
    const otherTasksHeader = screen.getByText(/Other Tasks/)
    await act(async () => {
      fireEvent.click(otherTasksHeader)
    })

    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.getByText('Write documentation')).toBeInTheDocument()

    // Click the checkbox
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    // Open tasks should still be visible
    expect(screen.getByText('Design new logo')).toBeInTheDocument()

    // Claimed task should be hidden - the Other Tasks section should contain
    // only Write documentation (open) since Fix login bug (claimed) is filtered out
    expect(screen.queryByText('Fix login bug')).not.toBeInTheDocument()
  })

  it('keeps "My Tasks" section visible regardless of filter state', async () => {
    const data = buildCrewData([MY_TASK, OPEN_TASK_1, CLAIMED_TASK_1])
    mockFetchResponses(data, { memberId: '42', name: 'TestUser' })

    const paramsPromise = Promise.resolve({ crewId: 'tech' })

    await act(async () => {
      render(
        <Suspense fallback={<div>Loading...</div>}>
          <CrewPage params={paramsPromise} />
        </Suspense>
      )
    })

    // Wait for crew data to load (the Tasks heading should appear)
    await waitFor(() => {
      const headings = screen.getAllByText(/Tasks \(/)
      expect(headings.length).toBeGreaterThanOrEqual(1)
    })

    // The user fetch is 3 chained async calls in a useEffect.
    // We need to flush these microtasks so user state is populated.
    // Each await act() tick allows the next promise in the chain to resolve.
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await new Promise(r => setTimeout(r, 10))
      })
    }

    // After user state loads, the MY_TASK should be recognized as "My Tasks"
    // because isMyTask checks t.leadId === user.memberId
    await waitFor(() => {
      expect(screen.getByText(/My Tasks/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // My Tasks section is expanded by default, so task should be visible
    expect(screen.getByText('My assigned work')).toBeInTheDocument()

    // Activate filter
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    // My task should still be visible (it has a lead but it's MY task -- filter preserves My Tasks)
    expect(screen.getByText('My assigned work')).toBeInTheDocument()
    // The "My Tasks" section heading should still be present
    expect(screen.getByText(/My Tasks/)).toBeInTheDocument()
  })

  it('hides empty sections when filter removes all their tasks', async () => {
    // All non-top tasks are claimed, so "Other Tasks" section should vanish when filter is active
    const claimedOther1 = makeTask({ task: 'Claimed other task', lead: 'Charlie', leadId: '300', priority: '3. Low' })
    const claimedOther2 = makeTask({ task: 'Another claimed', lead: 'Dave', leadId: '400', priority: '3. Low' })
    const data = buildCrewData([OPEN_TASK_1, claimedOther1, claimedOther2])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only/)).toBeInTheDocument()
    })

    // Before filter: Other Tasks section exists (collapsed by default, but header visible)
    expect(screen.getByText(/Other Tasks/)).toBeInTheDocument()

    // Activate filter
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    // Other Tasks section should be hidden because all its tasks have leads
    expect(screen.queryByText(/Other Tasks/)).not.toBeInTheDocument()
  })

  it('handles tasks with lead="#N/A" as open', async () => {
    const naTask = makeTask({ task: 'NA lead task', lead: '#N/A', priority: '0. Top' })
    const data = buildCrewData([naTask, CLAIMED_TASK_1])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only/)).toBeInTheDocument()
    })

    // Count in checkbox label should be 1 (one open task)
    expect(screen.getByText(/Show open tasks only \(1\)/)).toBeInTheDocument()

    // Activate filter
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    // The #N/A task should still be visible
    expect(screen.getByText('NA lead task')).toBeInTheDocument()
  })

  it('handles tasks with whitespace-only lead as open', async () => {
    const whitespaceTask = makeTask({ task: 'Whitespace lead task', lead: '   ', priority: '0. Top' })
    const data = buildCrewData([whitespaceTask, CLAIMED_TASK_1])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only \(1\)/)).toBeInTheDocument()
    })
  })

  it('displays correct open count in heading when multiple open tasks exist', async () => {
    const data = buildCrewData([OPEN_TASK_1, OPEN_TASK_2, OPEN_TASK_3, CLAIMED_TASK_1])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText(/Show open tasks only/)).toBeInTheDocument()
    })

    // 3 open tasks out of 4 total
    expect(screen.getByText(/Show open tasks only \(3\)/)).toBeInTheDocument()

    // Activate filter
    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })
    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(screen.getByText('Tasks (3 open / 4 total)')).toBeInTheDocument()
  })

  it('toggles filter on and off correctly', async () => {
    const data = buildCrewData([OPEN_TASK_1, CLAIMED_TASK_1])
    await renderCrewPage(data)

    await waitFor(() => {
      expect(screen.getByText('Design new logo')).toBeInTheDocument()
    })

    const checkbox = screen.getByRole('checkbox', { name: /Show open tasks only/ })

    // Initially unchecked
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('Tasks (2)')).toBeInTheDocument()

    // Check it
    await act(async () => {
      fireEvent.click(checkbox)
    })
    expect(checkbox).toBeChecked()
    expect(screen.getByText('Tasks (1 open / 2 total)')).toBeInTheDocument()

    // Uncheck it
    await act(async () => {
      fireEvent.click(checkbox)
    })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('Tasks (2)')).toBeInTheDocument()
  })
})
