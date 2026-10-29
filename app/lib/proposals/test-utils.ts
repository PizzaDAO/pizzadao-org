/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helpers for the proposals tests: a real RSA key pair, the browser side of the blind-signature flow,
// and a small in-memory stand-in for the Prisma models the store uses.
import { finalize, blind, fromBase64, importPublicKey, prepareMessage, toBase64 } from '@/utils/blindRsa.client'
import { signBlinded, type BallotCredentials } from './token'

function pem(label: string, der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`
}

export async function makeKeyEnv(): Promise<NodeJS.ProcessEnv> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-384' },
    true,
    ['sign', 'verify'],
  )
  return {
    RSA_PRIVATE_KEY_PEM: pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    RSA_PUBLIC_KEY_PEM: pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
  } as unknown as NodeJS.ProcessEnv
}

/** What the member's browser does: blind a fresh token. Returns the blinded message and a finisher. */
export async function startBlind(env: NodeJS.ProcessEnv, proposalId: string) {
  const publicKey = await importPublicKey(env.RSA_PUBLIC_KEY_PEM!)
  const token = `proposal-${proposalId}-${crypto.randomUUID()}`
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

/** Full issue-and-unblind flow with the real signer (no database). */
export async function mintCredentials(env: NodeJS.ProcessEnv, proposalId: string): Promise<BallotCredentials> {
  const b = await startBlind(env, proposalId)
  return b.finish(await signBlinded(b.blinded, env))
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
        const row = { id: `p${++state.seq}`, status: 'DRAFT', ayes: 0, nays: 0, abstains: 0, countAbstains: true, requireAyesOverNays: true, opensAt: null, closesAt: null, closedAt: null, ayesNeeded: null, eligibleCount: null, ...data }
        state.proposal.push(row)
        return row
      },
      findUnique: async ({ where }: any) => state.proposal.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => state.proposal.filter((r) => matchWhere(r, where)),
      update: async ({ where, data }: any) => Object.assign(state.proposal.find((r) => matchWhere(r, where))!, data),
    },
    proposalVoter: {
      findUnique: async ({ where }: any) => state.voter.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => state.voter.filter((r) => matchWhere(r, where)),
      createMany: async ({ data }: any) => {
        for (const d of data) if (!state.voter.some((r) => r.proposalId === d.proposalId && r.discordId === d.discordId)) state.voter.push({ tokenIssuedAt: null, ...d })
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
