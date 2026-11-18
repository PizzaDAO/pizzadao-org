// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))

import { pageForSetting, revalidateForSetting, revalidatePublicPage } from './revalidate-public'

beforeEach(() => revalidatePath.mockReset())

describe('revalidate-public', () => {
  it('maps the public switches to their pages', () => {
    expect(pageForSetting('education.publicListingEnabled')).toBe('learn')
    expect(pageForSetting('education.publicIntroText')).toBe('learn')
    expect(pageForSetting('features.publicEnabled')).toBe('features')
    expect(pageForSetting('buddy.publicRecognitionEnabled')).toBe('buddies')
    expect(pageForSetting('economy.roleIncome')).toBeNull()
  })

  it('revalidates the page path on a setting save, and nothing for an unrelated key', () => {
    revalidateForSetting('education.publicListingEnabled')
    expect(revalidatePath).toHaveBeenCalledWith('/learn')
    revalidatePath.mockClear()
    revalidateForSetting('economy.roleIncome')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('swallows a failure outside a request', () => {
    revalidatePath.mockImplementationOnce(() => {
      throw new Error('outside request')
    })
    expect(() => revalidatePublicPage('features')).not.toThrow()
  })
})
