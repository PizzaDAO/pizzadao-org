import { describe, it, expect } from 'vitest'
import { RSABSSA } from '@cloudflare/blindrsa-ts'
import {
  isTokenForPoll,
  preparedMessageEncodesToken,
  validateVoteTokenBinding,
  RSABSSA_RANDOMIZED_PREFIX_LEN,
} from './voteToken'

// Same suite the client uses (utils/blindRsa.client.ts)
const prepare = (token: string) =>
  RSABSSA.SHA384.PSS.Randomized().prepare(new TextEncoder().encode(token))

describe('vote token binding', () => {
  const pollId = 'abc123'
  const token = `poll-${pollId}-6f1c2a8e-1111-4222-8333-944445555666`

  it('accepts a prepared message produced by the client for the same token', () => {
    const prepared = prepare(token)
    expect(prepared.length).toBe(RSABSSA_RANDOMIZED_PREFIX_LEN + token.length)
    expect(preparedMessageEncodesToken(prepared, token)).toBe(true)
    expect(validateVoteTokenBinding(token, pollId, prepared)).toBeNull()
  })

  it('rejects replaying one prepared message/signature with a different token', () => {
    const prepared = prepare(token)
    const otherToken = `poll-${pollId}-00000000-0000-4000-8000-000000000000`
    expect(preparedMessageEncodesToken(prepared, otherToken)).toBe(false)
    expect(validateVoteTokenBinding(otherToken, pollId, prepared)).toBe('Token does not match signed message')
  })

  it('rejects a token whose length differs from the signed suffix', () => {
    const prepared = prepare(token)
    expect(preparedMessageEncodesToken(prepared, token + 'x')).toBe(false)
    expect(preparedMessageEncodesToken(prepared, token.slice(0, -1))).toBe(false)
    expect(preparedMessageEncodesToken(prepared.subarray(1), token)).toBe(false)
  })

  it('rejects tokens for another poll, even when correctly bound', () => {
    const otherPollToken = `poll-other-${'x'.repeat(8)}`
    const prepared = prepare(otherPollToken)
    expect(validateVoteTokenBinding(otherPollToken, pollId, prepared)).toBe('Token is not for this poll')
  })

  it('rejects a poll id that is only a prefix of the token poll id', () => {
    // token for poll "abc1234" must not count for poll "abc123"
    expect(isTokenForPoll(`poll-${pollId}4-nonce`, pollId)).toBe(false)
    expect(isTokenForPoll(`poll-${pollId}-`, pollId)).toBe(false)
    expect(isTokenForPoll(`poll-${pollId}-nonce`, pollId)).toBe(true)
  })
})
