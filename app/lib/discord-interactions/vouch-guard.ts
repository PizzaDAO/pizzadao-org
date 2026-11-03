/**
 * Disavow guard for the Discord /vouch command. Kept out of the interactions route on purpose: no
 * public API route may import the disavow lib (see lib/disavow/no-leak.test.ts), and the access module
 * pulls in the web session, so it is loaded on demand.
 *
 * True only for a voucher who could see the disavow warning on the website (eligible viewer, feature on)
 * AND a target who is actively listed. Fails open to "no warning" on any error, like the website: a failed
 * check never blocks a vouch, and nothing here is ever shown to anyone who is not eligible.
 */
export async function disavowWarns(voucherDiscordId: string, targetMemberId: string): Promise<boolean> {
  try {
    const [{ disavowViewer }, { findActiveListingFor }] = await Promise.all([import('@/app/lib/disavow/access'), import('@/app/lib/disavow/match')])
    if (!(await disavowViewer(voucherDiscordId)).allowed) return false
    return !!(await findActiveListingFor(targetMemberId))
  } catch {
    return false
  }
}
