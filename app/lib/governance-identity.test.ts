import { describe, it, expect, vi, afterEach } from 'vitest'
import { governanceEndpoint, createGovernanceIdentity } from './governance-identity'

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv

afterEach(() => vi.unstubAllGlobals())

describe('governanceEndpoint', () => {
  it('is null when unset (no localhost default)', () => {
    expect(governanceEndpoint(env({}))).toBeNull()
  })
  it('requires https', () => {
    expect(governanceEndpoint(env({ GOVERNANCE_API_URL: 'http://gov.example.com' }))).toBeNull()
    expect(governanceEndpoint(env({ GOVERNANCE_API_URL: 'https://gov.example.com' }))).toBe(
      'https://gov.example.com/api/governance/create-identity',
    )
  })
  it('allows http localhost only in development', () => {
    expect(governanceEndpoint(env({ GOVERNANCE_API_URL: 'http://localhost:3003', NODE_ENV: 'production' }))).toBeNull()
    expect(governanceEndpoint(env({ GOVERNANCE_API_URL: 'http://localhost:3003', NODE_ENV: 'development' }))).toBe(
      'http://localhost:3003/api/governance/create-identity',
    )
  })
})

describe('createGovernanceIdentity', () => {
  it('skips when the dedicated secret is unset', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await createGovernanceIdentity('1', env({ GOVERNANCE_API_URL: 'https://g.example.com', GOOGLE_SHEETS_SHARED_SECRET: 'sheets' }))
    expect(f).not.toHaveBeenCalled()
  })
  it('sends the dedicated secret, never the sheets secret', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f)
    await createGovernanceIdentity('1', env({ GOVERNANCE_API_URL: 'https://g.example.com', GOVERNANCE_API_SECRET: 'gov', GOOGLE_SHEETS_SHARED_SECRET: 'sheets' }))
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body).toEqual({ discordId: '1', secret: 'gov' })
    expect(f.mock.calls[0][1].signal).toBeDefined()
  })
  it('swallows fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    await expect(createGovernanceIdentity('1', env({ GOVERNANCE_API_URL: 'https://g.example.com', GOVERNANCE_API_SECRET: 'g' }))).resolves.toBeUndefined()
  })
})
