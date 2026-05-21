import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MissionCompleteCelebration } from '../MissionCompleteCelebration'

describe('MissionCompleteCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the default headline', () => {
    render(<MissionCompleteCelebration onDismiss={() => {}} autoDismissMs={0} />)
    expect(screen.getByText(/mission complete/i)).toBeTruthy()
  })

  it('shows custom title + subtitle when provided', () => {
    render(
      <MissionCompleteCelebration
        title="You did it!"
        subtitle="Level 1, mission 1"
        onDismiss={() => {}}
        autoDismissMs={0}
      />,
    )
    expect(screen.getByText('You did it!')).toBeTruthy()
    expect(screen.getByText('Level 1, mission 1')).toBeTruthy()
  })

  it('calls onDismiss when "Nice!" button is clicked', () => {
    const onDismiss = vi.fn()
    render(<MissionCompleteCelebration onDismiss={onDismiss} autoDismissMs={0} />)
    fireEvent.click(screen.getByRole('button', { name: /nice/i }))
    // Fade-out delay is ~200ms before onDismiss fires
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the backdrop is clicked', () => {
    const onDismiss = vi.fn()
    render(<MissionCompleteCelebration onDismiss={onDismiss} autoDismissMs={0} />)
    fireEvent.click(screen.getByTestId('mission-celebration-overlay'))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after the configured delay', () => {
    const onDismiss = vi.fn()
    render(<MissionCompleteCelebration onDismiss={onDismiss} autoDismissMs={1000} />)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // After the auto-dismiss timer fires there is a 300ms fade before onDismiss
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dismiss when autoDismissMs is 0', () => {
    const onDismiss = vi.fn()
    render(<MissionCompleteCelebration onDismiss={onDismiss} autoDismissMs={0} />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
