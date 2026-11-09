/**
 * The start-of-call notice is the admin setting calls.startNotice (empty = post nothing). Made safe
 * here as well as in the app: no @everyone/@here/role/user mentions, trimmed, at most 500 characters.
 * Returns '' when there is nothing to post.
 */
export function startNotice(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/<@[!&]?\d+>/g, ' ')
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .trim()
    .slice(0, 500)
    .trim()
}

export function lateJoinWelcome(userId: string): string {
  return `Welcome to the call, <@${userId}>!`
}

/** Most mentions in one welcome message; the rest become "and N others". */
export const MAX_WELCOME_MENTIONS = 20

/**
 * A name safe to drop into a message: no mentions, no markdown, one line, at most 60 characters.
 * Empty input gives "call".
 */
export function sanitizeCallName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/<[@#&!][^>]*>/g, ' ') // user / channel / role mentions
    .replace(/@(everyone|here)/gi, ' ')
    .replace(/[*_~`|>\\[\]()]/g, ' ') // markdown
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return cleaned || 'call'
}

/** "Ops Crew" -> "Ops Crew call"; a name already ending in "call" is kept. */
export function callDisplayName(label: string | null | undefined, eventName: string | null | undefined): string {
  const name = sanitizeCallName(label || eventName)
  if (name === 'call' || /\bcall$/i.test(name)) return name
  return label ? `${name} call` : name
}

function mentionList(userIds: readonly string[]): string {
  const shown = userIds.slice(0, MAX_WELCOME_MENTIONS).map((id) => `<@${id}>`)
  const rest = userIds.length - shown.length
  return rest > 0 ? `${shown.join(' ')} and ${rest} other${rest === 1 ? '' : 's'}` : shown.join(' ')
}

/** Fills the template. Replacer functions, so "$&" in a name or template is not special. */
export function fillWelcome(template: string, userIds: readonly string[], callName: string): string {
  return template.replace(/\{members\}/g, () => mentionList(userIds)).replace(/\{call\}/g, () => callName)
}

/** The ids that get an actual mention in a batch (for allowedMentions). */
export function mentionedIds(userIds: readonly string[]): string[] {
  return userIds.slice(0, MAX_WELCOME_MENTIONS)
}

/** A batched welcome for people who joined: the friendly line plus the short recording line. */
export function welcomeBatch(template: string, userIds: readonly string[], callName: string, recordingLine: string): string {
  return `${fillWelcome(template, userIds, callName)}\n${recordingLine}`
}

/**
 * The first message of a recorded call when welcomes are on: the welcome for whoever is already here,
 * then the start notice (calls.startNotice) when one is set.
 */
export function welcomeOpening(template: string, userIds: readonly string[], callName: string, notice = ''): string {
  const greeting = userIds.length
    ? fillWelcome(template, userIds, callName)
    : fillWelcome(template, [], callName).replace(/\s{2,}/g, ' ')
  return notice ? `${greeting}\n\n${notice}` : greeting
}
