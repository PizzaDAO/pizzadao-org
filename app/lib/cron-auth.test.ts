// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isCronAuthorized } from './cron-auth'

const env = (CRON_SECRET?: string) => ({ CRON_SECRET }) as unknown as NodeJS.ProcessEnv

describe('isCronAuthorized', () => {
  it('accepts exactly "Bearer $CRON_SECRET" (what Vercel Cron sends)', () => {
    expect(isCronAuthorized('Bearer s3cret', env('s3cret'))).toBe(true)
    expect(isCronAuthorized('Bearer s3cret', env('  s3cret\n'))).toBe(true) // trimmed env value
  })

  it('rejects a wrong, partial or differently-cased secret', () => {
    expect(isCronAuthorized('Bearer nope', env('s3cret'))).toBe(false)
    expect(isCronAuthorized('Bearer s3cre', env('s3cret'))).toBe(false)
    expect(isCronAuthorized('Bearer s3cretX', env('s3cret'))).toBe(false)
    expect(isCronAuthorized('bearer s3cret', env('s3cret'))).toBe(false)
    expect(isCronAuthorized('s3cret', env('s3cret'))).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isCronAuthorized(null, env('s3cret'))).toBe(false)
    expect(isCronAuthorized(undefined, env('s3cret'))).toBe(false)
    expect(isCronAuthorized('', env('s3cret'))).toBe(false)
  })

  it('fails closed when CRON_SECRET is not configured', () => {
    expect(isCronAuthorized('Bearer ', env(undefined))).toBe(false)
    expect(isCronAuthorized('Bearer undefined', env(undefined))).toBe(false)
    expect(isCronAuthorized('Bearer ', env('   '))).toBe(false)
  })
})
