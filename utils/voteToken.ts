// utils/voteToken.ts
// Binding checks for anonymous (blind-RSA) vote tokens.
//
// The client prepares the token with RSABSSA-SHA384-PSS-Randomized
// (see utils/blindRsa.client.ts prepareMessage): preparedMessage is a
// 32-byte random prefix followed by UTF-8(token). The server only verifies the
// signature over preparedMessage, so it MUST also check that preparedMessage
// actually encodes `token`; otherwise a single signature could be replayed with
// unlimited fresh tokens.

/** Length of the random prefix added by RSABSSA "Randomized" prepare. */
export const RSABSSA_RANDOMIZED_PREFIX_LEN = 32

/** Token format issued by components/AnonymousVote.tsx: poll-<pollId>-<uuid>. */
export function isTokenForPoll(token: string, pollId: string): boolean {
  const prefix = `poll-${pollId}-`
  return token.startsWith(prefix) && token.length > prefix.length && token.length <= 512
}

/** True iff preparedMessage === <32 random bytes> || UTF-8(token). */
export function preparedMessageEncodesToken(preparedMessage: Uint8Array, token: string): boolean {
  const tokenBytes = new TextEncoder().encode(token)
  if (preparedMessage.length !== RSABSSA_RANDOMIZED_PREFIX_LEN + tokenBytes.length) return false
  const suffix = preparedMessage.subarray(RSABSSA_RANDOMIZED_PREFIX_LEN)
  let diff = 0
  for (let i = 0; i < tokenBytes.length; i++) diff |= suffix[i] ^ tokenBytes[i]
  return diff === 0
}

/**
 * Combined validation. Returns null when valid, or an error string.
 */
export function validateVoteTokenBinding(
  token: string,
  pollId: string,
  preparedMessage: Uint8Array,
): string | null {
  if (!isTokenForPoll(token, pollId)) return 'Token is not for this poll'
  if (!preparedMessageEncodesToken(preparedMessage, token)) return 'Token does not match signed message'
  return null
}
