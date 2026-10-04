import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { JobCard } from '../JobCard'

const job = { id: 7, description: 'Share a pizza photo', type: 'Social', assignees: [] }

describe('JobCard', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, reward: 50 }), { status: 200 }),
    ) as unknown as typeof fetch
  })
  afterEach(() => vi.restoreAllMocks())

  it('is a single button showing a plain "50 $PEP" reward', () => {
    render(<JobCard job={job} rewardAmount={50} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAttribute('type', 'button')
    expect(buttons[0]).toHaveTextContent('Share a pizza photo')
    expect(buttons[0]).toHaveTextContent('50 $PEP')
    expect(screen.queryByRole('img')).toBeNull() // no PEP icon
    expect(buttons[0]).toBeEnabled()
  })

  it('clicking anywhere on the card completes the job, then disables it', async () => {
    render(<JobCard job={job} rewardAmount={50} />)
    fireEvent.click(screen.getByText('Share a pizza photo'))
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
    expect(global.fetch).toHaveBeenCalledWith('/api/jobs/assign', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('button')).toHaveTextContent('+50 $PEP')
    expect(screen.getByRole('button')).toHaveTextContent('Paid')
  })

  it('is disabled when already completed or disabled by the board', () => {
    const { rerender } = render(<JobCard job={job} rewardAmount={50} alreadyCompleted />)
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<JobCard job={job} rewardAmount={50} disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows the error as an alert tied to the card', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Already done today' }), { status: 400 }),
    ) as unknown as typeof fetch
    render(<JobCard job={job} rewardAmount={50} />)
    fireEvent.click(screen.getByRole('button'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Already done today')
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', alert.id)
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
