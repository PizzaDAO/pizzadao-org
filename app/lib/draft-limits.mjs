// Draft field limits and URL check, shared by the API (crew-drafts.ts) and scripts/.

export const MAX_DRAFT_TEXT = 5000
export const MAX_NOTES = 1000
export const MAX_URL = 2000

/** @param {string} u */
export function isHttpsUrl(u) {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}
