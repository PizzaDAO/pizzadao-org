// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/app/lib/i18n/test-utils'
import { saveBallot } from '@/app/lib/proposals/client'
import { FAILED_KEY, QUEUE_KEY } from '@/app/lib/proposals/vote-queue'
import { VotePanel } from './VotePanel'

vi.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))

const ID = 'abcdefgh12345678'
const closes = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const panel = (over: Partial<React.ComponentProps<typeof VotePanel>> = {}) =>
  renderWithIntl(<VotePanel proposalId={ID} open eligible tokenIssued fingerprint={null} closesAt={closes()} delayMinSeconds={60} delayMaxSeconds={60} {...over} />)

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  saveBallot(ID, { token: `proposal-${ID}-x`, preparedMessage: 'p', signature: 's' })
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

const voteCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/vote'))

describe('VotePanel with the send delay', () => {
  it('tapping a choice queues it and shows the not-sent-yet line with Send now', async () => {
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Aye' }))
    expect(await screen.findByText(/Not sent yet \(Aye\)\. It goes in about 1 minute/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)[0]).toMatchObject({ id: ID, choice: 'AYE' })
    expect(voteCalls()).toHaveLength(0)
  })

  it('Send now sends at once and shows Recorded', async () => {
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Nay' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(voteCalls()).toHaveLength(1))
    expect(await screen.findByText(/Recorded: Nay/)).toBeTruthy()
  })

  it('shows the closed message for a failed change and keeps the recorded choice as current', async () => {
    saveBallot(ID, { token: `proposal-${ID}-x`, preparedMessage: 'p', signature: 's', choice: 'AYE' })
    localStorage.setItem(FAILED_KEY, JSON.stringify({ [ID]: { choice: 'NAY', reason: 'closed' } }))
    panel()
    expect(await screen.findByText(/Voting is closed\. Your change to Nay did not go through; Aye is what counts\./)).toBeTruthy()
    expect(screen.getByText(/Recorded: Aye/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aye' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the generic error for a refused vote', async () => {
    localStorage.setItem(FAILED_KEY, JSON.stringify({ [ID]: { choice: 'NAY', reason: 'invalid' } }))
    panel()
    expect(await screen.findByText('Could not record your vote. Try again.')).toBeTruthy()
  })

  it('sends at once when storage cannot hold a queue', async () => {
    const set = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === QUEUE_KEY) throw new Error('blocked')
      return set.call(this, k, v)
    })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Abstain' }))
    await waitFor(() => expect(voteCalls()).toHaveLength(1))
  })
})

describe('VotePanel vote code line', () => {
  it('shows a collapsed "another device" line with Copy, which says Copied', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    panel()
    expect(await screen.findByText('Voting from another device too?')).toBeTruthy()
    expect(screen.queryByText(/Your ballot lives in this browser/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy vote code' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(writeText).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(screen.getByText(/Your ballot lives in this browser\. Paste this code on your phone/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back up with a wallet' })).toBeTruthy()
  })

  it('shows nothing about codes when voting is closed', () => {
    panel({ open: false })
    expect(screen.getByText('Voting is closed.')).toBeTruthy()
    expect(screen.queryByText('Voting from another device too?')).toBeNull()
  })

  it('asks for a pasted code in one sentence when the ballot was issued elsewhere', async () => {
    localStorage.clear()
    panel()
    expect(await screen.findByText('Already voted from another device? Paste your vote code to vote here.')).toBeTruthy()
    expect(screen.getByLabelText('Vote code')).toBeTruthy()
  })
})
