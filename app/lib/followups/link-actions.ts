/**
 * What a signed follow-up link does (app/fu/[token] and app/api/fu/[token]). Possession of the
 * link is the authority, like an email unsubscribe link: the token names one follow-up and one
 * action, and the action runs as the person the follow-up was sent to. Looking never changes
 * anything; only performLinkAction does.
 */
import { prisma } from '@/app/lib/db'
import { applyMemberAction, type ActionResult } from './actions'
import { verifyLink, type LinkClaims } from './links'
import { OPEN_AFTER_SEND } from './state'
import { undoOptOut } from './store'

export type LinkView =
  | { ok: true; claims: LinkClaims; ask: string; status: string; open: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'not-found' }

/** Read-only: the ask the link is about and whether it can still be acted on. */
export async function lookupLink(token: string, now = new Date()): Promise<LinkView> {
  const v = verifyLink(token, now)
  if (!v.ok) return v
  const row = await prisma.followUp.findUnique({ where: { id: v.claims.f }, select: { ask: true, status: true, ownerDiscordId: true } })
  if (!row || !row.ownerDiscordId) return { ok: false, reason: 'not-found' }
  // Stopping always works; the other actions need a sent, still-open follow-up (a reply is also welcome after DONE).
  const open = v.claims.a === 'stop' || (OPEN_AFTER_SEND as readonly string[]).includes(row.status) || (row.status === 'DONE' && v.claims.a === 'reply')
  return { ok: true, claims: v.claims, ask: row.ask, status: row.status, open }
}

export type LinkResult = ActionResult | { ok: false; reason: 'invalid' | 'expired' } | { ok: true; kind: 'undone' }

export async function performLinkAction(token: string, input: { text?: string; undo?: boolean } = {}, now = new Date()): Promise<LinkResult> {
  const v = verifyLink(token, now)
  if (!v.ok) return v
  const row = await prisma.followUp.findUnique({ where: { id: v.claims.f }, select: { id: true, ownerDiscordId: true } })
  if (!row || !row.ownerDiscordId) return { ok: false, reason: 'not-found' }
  const actorId = `link:${v.claims.a}`
  if (input.undo) {
    // Only the Stop link can be undone, and only for a few minutes.
    if (v.claims.a !== 'stop') return { ok: false, reason: 'invalid' }
    return (await undoOptOut(row.ownerDiscordId, actorId, row.id, now)) ? { ok: true, kind: 'undone' } : { ok: false, reason: 'closed' }
  }
  return applyMemberAction({ followUpId: row.id, discordId: row.ownerDiscordId, actorId, action: v.claims.a, ...(v.claims.a === 'reply' ? { text: input.text } : {}) })
}
