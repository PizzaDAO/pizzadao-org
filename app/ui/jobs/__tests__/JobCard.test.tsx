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

  it('is a single button covering the card, with an accessible name and a plain "50 $PEP" reward', () => {
    render(<JobCard job={job} rewardAmount={50} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAttribute('type', 'button')
    expect(buttons[0]).toHaveAccessibleName(/Share a pizza photo/)
    expect(buttons[0]).toHaveAccessibleName(/50 \$PEP/)
    expect(screen.getByTestId('job-card')).toHaveTextContent('Share a pizza photo')
    expect(screen.getByTestId('job-card')).toHaveTextContent('50 $PEP')
    expect(screen.queryByRole('img')).toBeNull() // no PEP icon
    expect(buttons[0]).toBeEnabled()
  })

  it('clicking anywhere on the card completes the job, then disables it', async () => {
    render(<JobCard job={job} rewardAmount={50} />)
    // The button is a stretched overlay covering the whole card — clicking
    // it is how "click anywhere on the card" behaves in a real browser.
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
    expect(global.fetch).toHaveBeenCalledWith('/api/jobs/assign', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByTestId('job-card')).toHaveTextContent('+50 $PEP')
    expect(screen.getByTestId('job-card')).toHaveTextContent('Paid')
    expect(screen.getByRole('button')).toHaveAccessibleName(/Paid/)
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

  describe('a link embedded in the description', () => {
    const jobWithLink = {
      id: 8,
      description: 'Check <#1099323056012394556> for details',
      type: 'Social',
      assignees: [],
    }
    const channels = { '1099323056012394556': 'partner-suggestions' }

    it('renders as a real, clickable anchor instead of completing the job', () => {
      const onAssign = vi.fn()
      render(
        <JobCard job={jobWithLink} rewardAmount={50} channels={channels} guildId="999" onAssign={onAssign} />,
      )
      const link = screen.getByRole('link', { name: '#partner-suggestions' })
      expect(link).toHaveAttribute('href', 'https://discord.com/channels/999/1099323056012394556')
      expect(link).toHaveAttribute('target', '_blank')
      // Clicking the link does not reach the job-completion button: a real
      // <a> is never a descendant of the <button> (it can't be — that
      // would be invalid HTML), so there's nothing for the click to
      // bubble into.
      fireEvent.click(link)
      expect(global.fetch).not.toHaveBeenCalled()
      expect(screen.getByRole('button')).toBeEnabled()
    })

    it('keeps the link clickable even when the job is already completed', () => {
      render(
        <JobCard job={jobWithLink} rewardAmount={50} channels={channels} guildId="999" alreadyCompleted />,
      )
      expect(screen.getByRole('button')).toBeDisabled()
      const link = screen.getByRole('link', { name: '#partner-suggestions' })
      expect(link).toHaveAttribute('href', 'https://discord.com/channels/999/1099323056012394556')
    })
  })
})
