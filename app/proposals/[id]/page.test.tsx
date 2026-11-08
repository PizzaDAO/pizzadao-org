/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
// The detail page: an OPEN app proposal keeps its vote panel; an imported row never gets one, even when forced
// to look open, and its payments link to the configured block explorer.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const m = vi.hoisted(() => ({ detail: null as any, hist: null as any }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') }, redirect: () => { throw new Error('redirect') } }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (k: string) => k }))
vi.mock('@/app/lib/session', () => ({ getSession: async () => ({ discordId: 'viewer' }) }))
vi.mock('@/app/lib/settings', () => ({ getSetting: async () => '' }))
vi.mock('@/app/lib/people', () => ({ resolvePeople: async () => new Map() }))
vi.mock('@/app/lib/discord-mention-resolve', () => ({ resolveDiscordMentions: async () => ({ channels: {}, roles: {} }) }))
vi.mock('@/app/lib/proposals/store', () => ({ getProposalDetail: async () => m.detail, viewerStates: async () => ({}) }))
vi.mock('@/app/lib/proposals/history', async (orig) => ({ ...(await orig<typeof import('@/app/lib/proposals/history')>()), getHistoryDetail: async () => m.hist }))
vi.mock('../_components/VotePanel', () => ({ VotePanel: function VotePanel() { return null } }))
vi.mock('@/app/ui/shared/Editorial', () => ({
  EditorialPage: function EditorialPage(p: { children: ReactNode }) { return p.children },
  EditorialMasthead: function EditorialMasthead() { return null },
  paperCard: 'card',
}))

import ProposalPage from './page'

const base = { id: 'p1', kind: 'FUNDING', title: 'Synthetic', amountUsd: 100, city: null, opensAt: null, closesAt: '2030-01-01T00:00:00Z', result: null, body: 'text <@123456789012345678>', keyFingerprint: 'AB CD', eventDate: null, sponsorLabel: null, ayesNeeded: 15, eligibleCount: 3, isProposer: false, proposerLabel: 'Written Name', proposedAt: null, votes: null, historical: null, paid: false, paidUsd: null, votesRecorded: true }

function find(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((c) => find(c, pred, out)); return out }
  if (pred(node)) out.push(node)
  if (typeof node.type === 'function' && node.type.name !== 'VotePanel') {
    // Expand function components (HistoryCard) to look inside them.
    try { find(node.type(node.props), pred, out) } catch { /* not renderable here */ }
  }
  find(node.props?.children, pred, out)
  return out
}
function texts(node: any, out: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((c) => texts(c, out)); return out }
  if (typeof node.type === 'function' && node.type.name !== 'VotePanel') { try { texts(node.type(node.props), out) } catch { /* skip */ } }
  texts(node.props?.children, out)
  return out
}
const render = async () => ProposalPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) })
const hasPanel = (tree: any) => find(tree, (n) => typeof n.type === 'function' && n.type.name === 'VotePanel').length > 0

beforeEach(() => {
  m.hist = null
})

describe('proposal detail page', () => {
  it('keeps the vote panel for an open app proposal', async () => {
    m.detail = { ...base, status: 'OPEN', source: 'APP' }
    expect(hasPanel(await render())).toBe(true)
  })

  it('never shows a vote panel or fingerprint for an imported row, even one forced to OPEN', async () => {
    m.detail = { ...base, status: 'OPEN', source: 'IMPORTED', outcomeSource: 'sheet' }
    m.hist = { links: [], payments: [], proposerDiscordId: null }
    const tree = await render()
    expect(hasPanel(tree)).toBe(false)
    const all = texts(tree).join('|')
    expect(all).not.toContain('detail.fingerprint')
    expect(all).not.toContain('detail.hidden')
    expect(all).toContain('history.heading')
  })

  it('links a payment through the explorer config', async () => {
    const h = `0x${'ab'.repeat(32)}`
    m.detail = { ...base, status: 'PASSED', source: 'IMPORTED', outcomeSource: 'votes', votes: { ayes: 1, nays: 0, abstains: 0 } }
    m.hist = {
      links: [{ id: 1, kind: 'discord_poll', url: 'https://discord.com/channels/1/2/3', label: 'Discord poll' }],
      payments: [{ id: 'a', paidAt: '2024-01-01', amount: '1', asset: 'ETH', chain: 'ethereum', usdValue: 100, txHash: h, offchainRef: null, note: null }, { id: 'b', paidAt: null, amount: null, asset: null, chain: 'mystery', usdValue: null, txHash: `0x${'cd'.repeat(32)}`, offchainRef: null, note: null }],
      proposerDiscordId: null,
    }
    const links = find(await render(), (n) => n.type === 'a').map((n) => n.props.href)
    expect(links).toContain(`https://etherscan.io/tx/${h}`)
    expect(links.some((l: string) => l.includes('cdcd'))).toBe(false)
  })
})
