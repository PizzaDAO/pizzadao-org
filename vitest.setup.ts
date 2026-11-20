import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '',
}))

// The trivia question bank lives in the database and is never committed (the repo is public): every test reads the
// MADE-UP fixture bank through an in-memory bank store. A test of the real store uses vi.unmock.
vi.mock('@/app/lib/trivia/bank-store', () => import('@/app/lib/trivia/__fixtures__/fake-bank-store'))

// Mock fetch globally
global.fetch = vi.fn()
