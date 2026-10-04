// Cache-Control for API responses whose data changes on every mutation
// (bounties, jobs, shop stock, balances, inventory, history, leaderboard).
// A shared CDN copy (s-maxage / stale-while-revalidate) made a just-posted
// bounty invisible for up to ~35 minutes after the client refetched, so these
// responses must never be stored by the CDN or the browser.
export const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const
