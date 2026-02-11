import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock next-themes
const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({ theme: 'light', setTheme: mockSetTheme, resolvedTheme: 'light', themes: [], systemTheme: undefined, forcedTheme: undefined })),
}))

// Mock next/font
vi.mock('next/font/google', () => ({
  Inter: () => ({ style: { fontFamily: 'Inter' } }),
}))

import { ThemeToggle } from '../ThemeToggle'
import { useTheme } from 'next-themes'

describe('ThemeToggle', () => {
  it('renders toggle button', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeTruthy()
  })

  it('calls setTheme("dark") when in light mode', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('calls setTheme("light") when in dark mode', () => {
    vi.mocked(useTheme).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme, resolvedTheme: 'dark', themes: [], systemTheme: undefined, forcedTheme: undefined })
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })
})
