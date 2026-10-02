// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { internalError, handleApiError } from './error-response'
import { ValidationError } from './api-errors'

describe('internalError', () => {
  it('logs the real error but returns only a generic message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = internalError(new Error('guilds.join failed (403): {"secret":"x"}'), 'test', 'Something failed')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Something failed' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('handleApiError', () => {
  it('passes ApiError messages through', async () => {
    const res = handleApiError(new ValidationError('bad input', 'x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad input')
  })

  it('never echoes Prisma error messages', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('Invalid `prisma.user.create()` invocation: column "x" ...')
    err.name = 'PrismaClientKnownRequestError'
    const res = handleApiError(err)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('An unexpected error occurred')
    spy.mockRestore()
  })
})
