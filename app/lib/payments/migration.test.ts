// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const dir = join(process.cwd(), 'prisma/migrations')
const sql = readFileSync(join(dir, '20261102400000_payment_requests', 'migration.sql'), 'utf8')

describe('payment requests migration', () => {
  it('has exactly one migration with that name and timestamp', () => {
    expect(readdirSync(dir).filter((d) => d.startsWith('20261102400000_'))).toEqual(['20261102400000_payment_requests'])
  })

  it('makes PaymentDecision append-only in the database itself', () => {
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PaymentDecision"/)
    expect(sql).toMatch(/BEFORE TRUNCATE ON "PaymentDecision"/)
    expect(sql).toMatch(/RAISE EXCEPTION 'PaymentDecision is append-only'/)
  })

  it('a request with decisions cannot be deleted out from under them', () => {
    expect(sql).toMatch(/"PaymentDecision_requestId_fkey"[^;]*ON DELETE RESTRICT/)
  })

  it('stores a claimed form id separately from the verified requester', () => {
    expect(sql).toMatch(/"claimedDiscordId" TEXT/)
  })
})
