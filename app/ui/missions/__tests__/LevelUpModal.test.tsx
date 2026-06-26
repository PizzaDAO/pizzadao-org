import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LevelUpModal } from '../LevelUpModal'

describe('LevelUpModal', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the level number and title', () => {
    render(
      <LevelUpModal
        level={2}
        levelTitle="Pizza Noob"
        reward={420}
        onDismiss={() => {}}
      />,
    )
    // The big level badge AND the heading both contain "2"
    expect(screen.getByText(/Level 2/i)).toBeTruthy()
    expect(screen.getByText('Pizza Noob')).toBeTruthy()
  })

  it('shows the reward when greater than zero', () => {
    render(
      <LevelUpModal
        level={3}
        levelTitle={null}
        reward={1337}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/\+1,337 \$PEP/i)).toBeTruthy()
  })

  it('hides the reward block when reward is zero', () => {
    render(
      <LevelUpModal level={3} levelTitle={null} reward={0} onDismiss={() => {}} />,
    )
    expect(screen.queryByText(/\$PEP/i)).toBeNull()
  })

  it('uses "Final Level Reached" copy on level 8', () => {
    render(
      <LevelUpModal
        level={8}
        levelTitle="Don of Dons"
        reward={69420}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/final level reached/i)).toBeTruthy()
    expect(screen.getByText(/Pizza Don/i)).toBeTruthy()
  })

  it('calls onDismiss when "Continue" is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <LevelUpModal
        level={2}
        levelTitle="Pizza Noob"
        reward={420}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the backdrop is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <LevelUpModal
        level={2}
        levelTitle="Pizza Noob"
        reward={420}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByTestId('level-up-modal'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
