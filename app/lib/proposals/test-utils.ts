/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helpers for the proposals tests: a real RSA key pair, the browser side of the blind-signature flow,
// and a small in-memory stand-in for the Prisma models the store uses.
import { finalize, blind, fromBase64, importPublicKey, prepareMessage, toBase64 } from '@/utils/blindRsa.client'
import { generateProposalKeyPair, wrapPrivateKey } from './keys'
import { signBlinded, type BallotCredentials } from './token'

/** A production-like env with a wrap secret: what the store needs to open, issue and count. */
export const testEnv = (): NodeJS.ProcessEnv =>
  ({ VERCEL_ENV: 'production', PROPOSAL_KEY_WRAP_SECRET: 'test-wrap-secret-test-wrap-secret-1234' }) as unknown as NodeJS.ProcessEnv

export interface TestKey {
  id: string
  keyPublicPem: string
  keyPrivateEnc: string
}

/** A per-proposal key pair as openProposal stores it (2048 bits to keep tests fast). */
export async function makeProposalKey(id: string, env: NodeJS.ProcessEnv = testEnv(), bits = 2048): Promise<TestKey> {
  const pair = await generateProposalKeyPair(bits)
  return { id, keyPublicPem: pair.publicPem, keyPrivateEnc: await wrapPrivateKey(pair.privatePem, id, env) }
}

/** What the member's browser does: blind a fresh token for `label`. Returns the blinded message and a finisher. */
export async function startBlind(publicPem: string, label: string) {
  const publicKey = await importPublicKey(publicPem)
  const token = `proposal-${label}-${crypto.randomUUID()}`
  const prepared = prepareMessage(token)
  const { blindedMessage, blindInverse } = await blind(publicKey, prepared)
  return {
    token,
    blinded: toBase64(blindedMessage),
    async finish(blindSignatureB64: string): Promise<BallotCredentials> {
      const sig = await finalize(publicKey, prepared, fromBase64(blindSignatureB64), blindInverse)
      return { token, preparedMessage: toBase64(prepared), signature: toBase64(sig) }
    },
  }
}

/** Full issue-and-unblind flow with the real signer: blinded under `signer`'s public key, token labelled `label`. */
export async function mintCredentials(signer: TestKey, env: NodeJS.ProcessEnv = testEnv(), label: string = signer.id): Promise<BallotCredentials> {
  const b = await startBlind(signer.keyPublicPem, label)
  return b.finish(await signBlinded(signer, b.blinded, env))
}

type Row = Record<string, any>

/** In-memory fakes for proposal, proposalVoter, proposalBallot, proposalEvent. */
export function makeFakeDb() {
  const state = { proposal: [] as Row[], voter: [] as Row[], ballot: [] as Row[], event: [] as Row[], seq: 0 }
  const matchWhere = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'proposalId_discordId') return row.proposalId === (v as Row).proposalId && row.discordId === (v as Row).discordId
      if (k === 'proposalId_tokenHash') return row.proposalId === (v as Row).proposalId && row.tokenHash === (v as Row).tokenHash
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return (v as any).in.includes(row[k])
        if ('not' in v) return row[k] !== (v as any).not
        if ('lte' in v) return row[k] <= (v as any).lte
        return true
      }
      return row[k] === v
    })
  const db: any = {
    proposal: {
      create: async ({ data }: any) => {
        const row = { id: `p${++state.seq}`, status: 'DRAFT', ayes: 0, nays: 0, abstains: 0, countAbstains: true, requireAyesOverNays: true, opensAt: null, closesAt: null, closedAt: null, ayesNeeded: null, eligibleCount: null, discordChannelId: null, discordMessageId: null, resultPostedAt: null, createdAt: new Date(0), ...data }
        state.proposal.push(row)
        return row
      },
      findUnique: async ({ where }: any) => state.proposal.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => state.proposal.filter((r) => matchWhere(r, where)),
      update: async ({ where, data }: any) => Object.assign(state.proposal.find((r) => matchWhere(r, where))!, data),
      updateMany: async ({ where, data }: any) => {
        const rows = state.proposal.filter((r) => matchWhere(r, where))
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
      },
    },
    proposalVoter: {
      findUnique: async ({ where }: any) => state.voter.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => state.voter.filter((r) => matchWhere(r, where)),
      createMany: async ({ data }: any) => {
        for (const d of data) if (!state.voter.some((r) => r.proposalId === d.proposalId && r.discordId === d.discordId)) state.voter.push({ tokenIssuedAt: null, ballotBlob: null, ...d })
        return { count: data.length }
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.voter.filter((r) => matchWhere(r, where))
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
      },
    },
    proposalBallot: {
      findMany: async ({ where }: any) => state.ballot.filter((r) => matchWhere(r, where)),
      upsert: async ({ where, create, update }: any) => {
        const hit = state.ballot.find((r) => matchWhere(r, where))
        if (hit) return Object.assign(hit, update)
        const row = { id: `b${++state.seq}`, ...create }
        state.ballot.push(row)
        return row
      },
    },
    proposalEvent: { create: async ({ data }: any) => { state.event.push(data); return data } },
    $queryRaw: async () => [],
    $transaction: async (fn: any) => fn(db),
  }
  return { db, state }
}

/** In-memory PendingStore, with switches to simulate Redis failing. */
export function makeFakePending() {
  const hashes = new Map<string, Map<string, string>>()
  const state = { failPut: false, failRemove: false, removed: 0 }
  const store = {
    async put(proposalId: string, tokenHash: string, choice: 'AYE' | 'NAY' | 'ABSTAIN') {
      if (state.failPut) throw new Error('redis down')
      if (!hashes.has(proposalId)) hashes.set(proposalId, new Map())
      hashes.get(proposalId)!.set(tokenHash, choice)
    },
    async all(proposalId: string) {
      return [...(hashes.get(proposalId) ?? new Map<string, string>())].map(([tokenHash, choice]) => ({ tokenHash, choice: choice as 'AYE' | 'NAY' | 'ABSTAIN' }))
    },
    async removeIfUnchanged(proposalId: string, entries: ReadonlyArray<{ tokenHash: string; choice: string }>) {
      if (state.failRemove) throw new Error('redis down')
      const h = hashes.get(proposalId)
      for (const e of entries) if (h?.get(e.tokenHash) === e.choice) { h.delete(e.tokenHash); state.removed++ }
    },
  }
  return { store, hashes, state }
}
