// @vitest-environment jsdom
// The preparer runs in the root layout on every page: bad or surprising answers must never throw or reach the console.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { parseMine } from '@/app/lib/proposals/client'
import { GlobalBallotPreparer } from './GlobalBallotPreparer'

vi.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> })) // eslint-disable-line @typescript-eslint/no-explicit-any

const good = { id: 'abcdefgh12345678', title: 'Party', tokenIssued: false }

describe('parseMine', () => {
  it('accepts only an enabled, well-formed answer', () => {
    expect(parseMine({ enabled: true, proposals: [good] })).toEqual([good])
  })
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '<html>404</html>'],
    ['an empty object (a mock)', {}],
    ['disabled', { enabled: false, proposals: [good] }],
    ['no flag', { proposals: [good] }],
    ['proposals missing', { enabled: true }],
    ['proposals not an array', { enabled: true, proposals: { a: 1 } }],
    ['proposals a string', { enabled: true, proposals: 'x' }],
  ])('returns [] for %s', (_n, body) => {
    expect(parseMine(body)).toEqual([])
  })
  it('skips malformed entries and defaults a missing tokenIssued to "already issued"', () => {
    const r = parseMine({ enabled: true, proposals: [null, 5, {}, { id: 'short', title: 'x' }, { id: 'abcdefgh12345678', title: 3 }, { id: 'abcdefgh12345678', title: 'ok' }] })
    expect(r).toEqual([{ id: 'abcdefgh12345678', title: 'ok', tokenIssued: true }])
  })
})

describe('GlobalBallotPreparer', () => {
  let errors: unknown[]
  const onError = (e: ErrorEvent) => errors.push(e.error)
  const onRejection = (e: PromiseRejectionEvent) => errors.push(e.reason)

  beforeEach(() => {
    errors = []
    sessionStorage.clear()
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
  })
  afterEach(() => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const run = async (fetchImpl: () => Promise<unknown>) => {
    const f = vi.fn(fetchImpl)
    vi.stubGlobal('fetch', f)
    const { container } = renderWithIntl(<GlobalBallotPreparer />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
    expect(errors).toEqual([])
  }
  const res = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body })

  it('is silent when the answer is {} (unknown route / mock)', () => run(() => res({})))
  it('is silent when the feature is off', () => run(() => res({ enabled: false, proposals: [] })))
  it('is silent when proposals is not an array', () => run(() => res({ enabled: true, proposals: 'nope' })))
  it('is silent when the body is not JSON', () => run(() => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('bad') } })))
  it('is silent on 401, 404 and 500', async () => {
    await run(() => res({ error: 'x' }, false))
  })
  it('is silent when fetch rejects', () => run(() => Promise.reject(new Error('offline'))))
  it('is silent when the answer is null', () => run(() => res(null)))
})

describe('no save-code card; closed proposals are pruned', () => {
  const id = 'abcdefgh12345678'
  const other = 'zyxwvuts87654321'
  const ballot = JSON.stringify({ token: 'proposal-x', preparedMessage: 'AA==', signature: 'AA==' })
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem(`pizzadao:proposal-ballot:${id}`, ballot)
    localStorage.setItem(`pizzadao:proposal-ballot:${other}`, ballot)
    localStorage.setItem('pizzadao:proposals-unsaved', JSON.stringify([{ id, title: 'Party' }]))
    // only `id` is still open
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, proposals: [{ id, title: 'Party', tokenIssued: true }] }) })))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows no card, and forgets ballots of proposals that are no longer open', async () => {
    const { container } = renderWithIntl(<GlobalBallotPreparer />)
    await waitFor(() => expect(localStorage.getItem(`pizzadao:proposal-ballot:${other}`)).toBeNull())
    expect(localStorage.getItem(`pizzadao:proposal-ballot:${id}`)).toBe(ballot)
    expect(localStorage.getItem('pizzadao:proposals-unsaved')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('turns a queued vote of a closed proposal into a failure and shows the compact banner', async () => {
    localStorage.setItem('pizzadao:proposal-vote-queue', JSON.stringify([{ id: other, choice: 'AYE', sendAt: Date.now() + 600000, closesAt: null }]))
    const { container, getByText } = renderWithIntl(<GlobalBallotPreparer />)
    await waitFor(() => expect(container.textContent).toContain('A vote could not be sent.'))
    expect(JSON.parse(localStorage.getItem('pizzadao:proposal-vote-queue')!)).toEqual([])
    expect(container.textContent).not.toContain('vote code')
    fireEvent.click(getByText('Open proposal'))
    expect(localStorage.getItem('pizzadao:proposal-vote-failed')).toContain(other)
  })

  it('prunes nothing when the feature answers "off"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: false, proposals: [] }) })))
    renderWithIntl(<GlobalBallotPreparer />)
    await new Promise((r) => setTimeout(r, 20))
    expect(localStorage.getItem(`pizzadao:proposal-ballot:${other}`)).toBe(ballot)
  })
})
