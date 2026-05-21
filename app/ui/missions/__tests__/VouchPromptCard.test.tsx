import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { VouchPromptCard } from '../VouchPromptCard'

// next/link in tests
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('VouchPromptCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the prompt copy', () => {
    render(<VouchPromptCard onDismiss={() => {}} />)
    expect(screen.getByText(/ask 3 members/i)).toBeTruthy()
    expect(screen.getByText(/vouches let other members/i)).toBeTruthy()
  })

  it('"Find members" link points to /crew and dismisses', () => {
    const onDismiss = vi.fn()
    render(<VouchPromptCard onDismiss={onDismiss} />)
    const link = screen.getByRole('link', { name: /find members/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/crew')
    fireEvent.click(link)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('"Maybe later" button calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(<VouchPromptCard onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /maybe later/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
