/**
 * Pending ballots: the mixing step between "a vote arrived" and "a ballot row exists".
 *
 * A vote is written as tokenHash -> choice into a Redis hash per proposal (`proposal-pending:<id>`); the same token
 * overwrites its earlier entry. The hourly cron (and settle, before counting) drains the hash into ProposalBallot in
 * ONE transaction, inserting in tokenHash order, so the order and time of rows in the database say nothing about when
 * or in what order people voted. A "saved" answer means the Redis write succeeded, i.e. the vote is durably recorded.
 *
 * Without Redis configured votes are written to the database directly (documented, weaker: row order and the database's
 * own history then follow vote time).
 *
 * Drain is idempotent and crash-safe: read everything (HGETALL), write it to the database (upserts), and only then delete
 * the drained fields that STILL hold the value that was drained (a vote changed in between stays for the next drain).
 */
import { Redis } from '@upstash/redis'

export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'
export const PENDING_TTL_SECONDS = 60 * 60 * 24 * 60

export interface PendingStore {
  /** Throws when the write did not succeed. */
  put(proposalId: string, tokenHash: string, choice: Choice): Promise<void>
  all(proposalId: string): Promise<Array<{ tokenHash: string; choice: Choice }>>
  /** Delete each field only if it still holds the given choice. */
  removeIfUnchanged(proposalId: string, entries: ReadonlyArray<{ tokenHash: string; choice: Choice }>): Promise<void>
}

export const pendingKey = (proposalId: string) => `proposal-pending:${proposalId}`
const HASH = /^[0-9a-f]{64}$/
const isChoice = (v: unknown): v is Choice => v === 'AYE' || v === 'NAY' || v === 'ABSTAIN'

/** Delete a field only when it still holds the expected value (atomic). */
const DEL_IF_EQUAL = `
local n = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
    n = n + 1
  end
end
return n`

export function upstashPendingStore(redis: Redis): PendingStore {
  return {
    async put(proposalId, tokenHash, choice) {
      const key = pendingKey(proposalId)
      await redis.hset(key, { [tokenHash]: choice })
      await redis.expire(key, PENDING_TTL_SECONDS)
    },
    async all(proposalId) {
      const raw = (await redis.hgetall<Record<string, unknown>>(pendingKey(proposalId))) ?? {}
      const out: Array<{ tokenHash: string; choice: Choice }> = []
      for (const [tokenHash, choice] of Object.entries(raw)) if (HASH.test(tokenHash) && isChoice(choice)) out.push({ tokenHash, choice })
      return out
    },
    async removeIfUnchanged(proposalId, entries) {
      if (entries.length === 0) return
      for (let i = 0; i < entries.length; i += 200) {
        const args = entries.slice(i, i + 200).flatMap((e) => [e.tokenHash, e.choice])
        await redis.eval(DEL_IF_EQUAL, [pendingKey(proposalId)], args)
      }
    },
  }
}

/** The Redis-backed store, or null when Redis is not configured (votes then go straight to the database). */
export function defaultPendingStore(env: NodeJS.ProcessEnv = process.env): PendingStore | null {
  const url = env.KV_REST_API_URL
  const token = env.KV_REST_API_TOKEN
  if (!url || !token) return null
  return upstashPendingStore(new Redis({ url, token }))
}

/** Entries sorted by tokenHash: the order rows are inserted in, unrelated to vote time. */
export function sortedByHash<T extends { tokenHash: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.tokenHash < b.tokenHash ? -1 : a.tokenHash > b.tokenHash ? 1 : 0))
}
