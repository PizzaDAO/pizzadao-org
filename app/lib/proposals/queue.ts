/**
 * When a vote is sent. A token fetched seconds before the vote would let request logs (IP + time, outside the app)
 * tie the vote to the member who fetched it. So a vote made while the token is still young waits until the token is
 * at least MIN_TOKEN_AGE_MS old, plus a random extra delay. Pure.
 */
export const MIN_TOKEN_AGE_MS = 30 * 60 * 1000
export const MAX_EXTRA_DELAY_MS = 15 * 60 * 1000
/** Never hold a vote so long it could miss the close. */
export const CLOSE_MARGIN_MS = 5 * 60 * 1000

export function planVoteSend(i: { now: number; preparedAt: number; closesAt: number | null; rand: number }): { sendAt: number; immediate: boolean } {
  const base = Math.max(i.now, i.preparedAt + MIN_TOKEN_AGE_MS)
  // A token that is already old enough needs no extra delay; a young one gets a random one.
  const wait = i.now >= i.preparedAt + MIN_TOKEN_AGE_MS ? 0 : Math.floor(i.rand * MAX_EXTRA_DELAY_MS)
  let sendAt = base + wait
  if (i.closesAt != null && sendAt > i.closesAt - CLOSE_MARGIN_MS) sendAt = Math.max(i.now, i.closesAt - CLOSE_MARGIN_MS)
  return { sendAt, immediate: sendAt <= i.now }
}
