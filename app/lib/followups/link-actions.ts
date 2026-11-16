/**
 * What a signed follow-up link does (app/fu/[token] and app/api/fu/[token]). Possession of the
 * link is the authority, like an email unsubscribe link: the token names one follow-up and one
 * action, and the action runs as the person the follow-up was sent to. Looking never changes
 * anything; only performLinkAction does.
 */
import { prisma } from '@/app/lib/db'
import { applyMemberAction, setDoneUrl, type ActionResult } from './actions'
import { checkDoneUrl, linkOffered } from './done-url'
import { verifyLink, type LinkClaims } from './links'
import { OPEN_AFTER_SEND } from './state'
import { undoOptOut } from './store'

export type LinkView =
  /** `linkOnly`: a done link opened after the follow-up was already DONE; the page then only offers to add or change the finished-work link. */
  | { ok: true; claims: LinkClaims; ask: string; status: string; open: boolean; linkOnly: boolean; linkOk: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'not-found' }

/** Read-only: the ask the link is about and whether it can still be acted on. */
export async function lookupLink(token: string, now = new Date()): Promise<LinkView> {
  const v = verifyLink(token, now)
  if (!v.ok) return v
  const row = await prisma.followUp.findUnique({ where: { id: v.claims.f }, select: { ask: true, status: true, ownerDiscordId: true, actionKey: true } })
  if (!row || !row.ownerDiscordId) return { ok: false, reason: 'not-found' }
  // Stopping always works; the other actions need a sent, still-open follow-up (a reply is also welcome after DONE).
  // The finished-work link (field, and the done link reopened after DONE) only exists while the switches are on and the follow-up is tied to an item.
  const linkOk = v.claims.a === 'done' && (await linkOffered(row))
  const linkOnly = linkOk && row.status === 'DONE'
  const open = v.claims.a === 'stop' || (OPEN_AFTER_SEND as readonly string[]).includes(row.status) || (row.status === 'DONE' && v.claims.a === 'reply') || linkOnly
  return { ok: true, claims: v.claims, ask: row.ask, status: row.status, open, linkOnly, linkOk }
}

export type LinkResult = ActionResult | { ok: false; reason: 'invalid' | 'expired' } | { ok: true; kind: 'undone' }

export async function performLinkAction(token: string, input: { text?: string; url?: string; undo?: boolean } = {}, now = new Date()): Promise<LinkResult> {
  const v = verifyLink(token, now)
  if (!v.ok) return v
  const row = await prisma.followUp.findUnique({ where: { id: v.claims.f }, select: { id: true, ownerDiscordId: true, status: true, actionKey: true } })
  if (!row || !row.ownerDiscordId) return { ok: false, reason: 'not-found' }
  const actorId = `link:${v.claims.a}`
  if (input.undo) {
    // Only the Stop link can be undone, and only for a few minutes.
    if (v.claims.a !== 'stop') return { ok: false, reason: 'invalid' }
    return (await undoOptOut(row.ownerDiscordId, actorId, row.id, now)) ? { ok: true, kind: 'undone' } : { ok: false, reason: 'closed' }
  }
  if (v.claims.a === 'done') {
    const linkOk = await linkOffered(row)
    const wantsLink = linkOk && typeof input.url === 'string' && input.url.trim() !== ''
    // Already done: the link is all this can still do (and only when links are offered; otherwise it is closed as before).
    if (linkOk && row.status === 'DONE') return setDoneUrl({ followUpId: row.id, discordId: row.ownerDiscordId, actorId, url: input.url })
    // A bad link is refused before anything changes.
    if (wantsLink && !(await checkDoneUrl(input.url))) return { ok: false, reason: 'bad-url' }
    const done = await applyMemberAction({ followUpId: row.id, discordId: row.ownerDiscordId, actorId, action: 'done' })
    if (!done.ok || !wantsLink) return done
    // The done move already happened: a problem with the link (even an error) never turns it into a failure.
    const linked = await setDoneUrl({ followUpId: row.id, discordId: row.ownerDiscordId, actorId, url: input.url }).catch((e) => {
      console.error('[followup link] link failed:', e instanceof Error ? e.message.slice(0, 160) : 'error')
      return null
    })
    return linked && linked.ok && linked.notify ? { ...done, notify: linked.notify } : done
  }
  return applyMemberAction({ followUpId: row.id, discordId: row.ownerDiscordId, actorId, action: v.claims.a, ...(v.claims.a === 'reply' ? { text: input.text } : {}) })
}
