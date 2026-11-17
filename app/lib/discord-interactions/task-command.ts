/**
 * /task list | claim | mine | drop | add: the deferred half. The interaction handler answers within
 * Discord's 3 s window with a deferred EPHEMERAL reply (type 5, flags 64); this runs afterwards
 * (route: after()) and edits the reply in via the interaction webhook:
 *
 *   PATCH /webhooks/{application_id}/{token}/messages/@original
 *
 * Crew tasks, not bounties. Discord is only a front door: claiming and dropping call the same
 * claimCrewTask() as the crew page's Claim / Give up buttons (app/lib/crews/claim-task.ts), so the
 * rules, the audit trail and the update digest stay the same. Dependencies are injected so tests never
 * reach Discord or the database. See plans/discord-task-command.md.
 */
import { makeEmbed, type Embed, type EmbedAuthor } from './embeds'
import { esc, link, shortText } from './text'
import type { ClaimResult } from '@/app/lib/crews/claim-task'

const API = 'https://discord.com/api/v10'

export const TASK_SUBCOMMANDS = ['list', 'claim', 'mine', 'drop', 'add'] as const
export type TaskSub = (typeof TASK_SUBCOMMANDS)[number]

/** The CrewTask columns the replies need. */
export interface TaskRow {
  id: string
  label: string
  crewId: string
  stage?: string
  /** As the sheet held it ("Top", "High", ...). */
  priority?: string | null
  /** ISO date (YYYY-MM-DD). */
  due?: string | null
}

export interface TaskJob {
  sub: TaskSub
  /** Who ran it; the claim rules look the member up from this. */
  discordId: string
  /** The `crew` option of `list`, if given. */
  crewId?: string
  /** The `task` option of `claim` / `drop` (a CrewTask id from autocomplete). */
  taskId?: string
  /** `add`: the cleaned task text, optional priority (Top | High | Mid | Low) and ISO due date. */
  label?: string
  priority?: string | null
  due?: string | null
  /** `add`: the Discord interaction id, kept in the audit event. */
  interactionId?: string
  applicationId: string
  token: string
  author?: EmbedAuthor
}

export interface TaskDeps {
  /** Open, unclaimed tasks (database crews only), best first. */
  openTasks: (crewId?: string) => Promise<TaskRow[]>
  /** Open tasks the member leads. */
  myTasks: (discordId: string) => Promise<TaskRow[]>
  claim: (discordId: string, taskId: string) => Promise<ClaimResult>
  drop: (discordId: string, taskId: string) => Promise<ClaimResult>
  isMember: (discordId: string) => Promise<boolean>
  /** Crew id to display label. */
  crewLabels: () => Promise<Map<string, string>>
  /** `add`: lead of the crew, or guild admin (the crew page editor's rule). Fails closed. */
  canManageCrew: (discordId: string, crewId: string) => Promise<boolean>
  /** `add`: where the crew's tasks live; `unknown` means not a real crew. */
  crewSource: (crewId: string) => Promise<'db' | 'sheet' | 'unknown'>
  /** `add`: an open (not archived, not closed) task of this crew with the same normalized label. */
  findOpenDuplicate: (crewId: string, label: string) => Promise<TaskRow | null>
  /** `add`: writes the task and its audit event (createCrewTask); returns the new task id. */
  create: (crewId: string, input: { label: string; priority: string | null; due: string | null }, actor: string, eventData: Record<string, unknown>) => Promise<string>
  appUrl: string
  fetchImpl?: typeof fetch
}

/** Most tasks one /task list reply shows. */
export const LIST_CAP = 10
const LABEL_CHARS = 90
const BODY_LIMIT = 4000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A crew's task section on the site, or the crews page. */
export const crewUrl = (appUrl: string, crewId?: string | null) => (crewId ? `${appUrl}/crew/${encodeURIComponent(crewId)}#tasks` : `${appUrl}/crews`)

const crewName = (labels: Map<string, string>, crewId: string) => esc(labels.get(crewId) ?? crewId)

const PRIORITY: Array<[RegExp | string, string]> = [[/top/i, 'Top'], ['0', 'Top'], [/high/i, 'High'], ['1', 'High'], [/mid/i, 'Mid'], ['2', 'Mid'], [/low/i, 'Low'], ['3', 'Low']]
function priorityLabel(p?: string | null): string | undefined {
  const v = (p ?? '').trim()
  if (!v) return undefined
  for (const [m, label] of PRIORITY) if (typeof m === 'string' ? v === m : m.test(v)) return label
  return esc(v)
}

/** "Nov 30" from an ISO date; anything else is left out. */
function dueLabel(due?: string | null): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due ?? '')
  if (!m) return undefined
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}` : undefined
}

/** `Crew · task label · Top · due Nov 30` (priority and due left out when empty). */
export function taskLine(t: TaskRow, labels: Map<string, string>): string {
  const parts = [crewName(labels, t.crewId), shortText(t.label, LABEL_CHARS)]
  const p = priorityLabel(t.priority)
  if (p) parts.push(p)
  const d = dueLabel(t.due)
  if (d) parts.push(`due ${d}`)
  return parts.join(' · ')
}

export function renderEmpty(appUrl: string, crewId?: string, labels: Map<string, string> = new Map(), author?: EmbedAuthor): Embed {
  const where = crewId ? ` for ${crewName(labels, crewId)}` : ''
  return makeEmbed('success', `No open tasks right now${where}.`, `Look at the crew page for what is in progress: ${link(crewId ? 'Open the crew page' : 'Open the crews', crewUrl(appUrl, crewId))}`, { author })
}

/** Open tasks, best first (the caller passes them in that order): up to LIST_CAP, then "N more". */
export function renderList(rows: TaskRow[], appUrl: string, labels: Map<string, string>, crewId?: string, author?: EmbedAuthor): Embed {
  if (rows.length === 0) return renderEmpty(appUrl, crewId, labels, author)
  const shown = rows.slice(0, LIST_CAP)
  const more = rows.length - shown.length
  const board = link(more > 0 ? `${more} more on the website` : 'Open the crew page', crewUrl(appUrl, crewId))
  const foot = `\n\nSign up with \`/task claim\`. ${board}`
  let body = shown.map((t) => taskLine(t, labels)).join('\n')
  if (body.length > BODY_LIMIT - foot.length) body = body.slice(0, BODY_LIMIT - foot.length - 1) + '…'
  const head = `${rows.length} open task${rows.length === 1 ? '' : 's'}${crewId ? ` for ${crewName(labels, crewId)}` : ''}`
  return makeEmbed('success', head, body + foot, { author })
}

export function renderClaimed(task: { label: string; crewId: string }, appUrl: string, labels: Map<string, string>, author?: EmbedAuthor): Embed {
  return makeEmbed(
    'success',
    `You're on it: ${shortText(task.label, LABEL_CHARS)} (${crewName(labels, task.crewId)}).`,
    `Update its stage or give it up on the crew page.\n\n${link('Open the crew page', crewUrl(appUrl, task.crewId))}`,
    { author },
  )
}

export function renderMine(rows: TaskRow[], appUrl: string, labels: Map<string, string>, author?: EmbedAuthor): Embed {
  if (rows.length === 0) {
    return makeEmbed('success', "You aren't leading any open tasks.", `Browse them with \`/task list\`. ${link('Open the crews', `${appUrl}/crews`)}`, { author })
  }
  const shown = rows.slice(0, LIST_CAP)
  const more = rows.length - shown.length
  const body = shown.map((t) => `${taskLine(t, labels)}${t.stage?.trim() ? ` · ${esc(t.stage.trim())}` : ''}`).join('\n')
  const foot = `\n\nUpdate stages on the crew page. ${link(more > 0 ? `${more} more on the website` : 'Open the crews', `${appUrl}/crews`)}`
  return makeEmbed('success', `Your tasks (${rows.length})`, body.slice(0, BODY_LIMIT - foot.length) + foot, { author })
}

export function renderDropped(task: { label: string }, author?: EmbedAuthor): Embed {
  return makeEmbed('success', `You dropped ${shortText(task.label, LABEL_CHARS)}.`, "It's open for anyone again.", { author })
}

/** `Added to Crew: label · High · due Dec 5`, with how to sign up. */
export function renderAdded(task: TaskRow, appUrl: string, labels: Map<string, string>, author?: EmbedAuthor): Embed {
  const parts = [shortText(task.label, LABEL_CHARS)]
  const p = priorityLabel(task.priority)
  if (p) parts.push(p)
  const d = dueLabel(task.due)
  if (d) parts.push(`due ${d}`)
  return makeEmbed('success', `Added to ${crewName(labels, task.crewId)}: ${parts.join(' · ')}`, `Anyone can sign up with \`/task claim\`.\n\n${link('Open the crew page', crewUrl(appUrl, task.crewId))}`, { author })
}

export function renderDuplicate(task: TaskRow, appUrl: string, labels: Map<string, string>, author?: EmbedAuthor): Embed {
  return makeEmbed('error', "That's already on the list:", `${taskLine(task, labels)}\n\n${link('Open the crew page', crewUrl(appUrl, task.crewId))}`, { author })
}

/** Prisma's unique-constraint error (a double submit that raced past the duplicate check). */
const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'

async function addTask(job: TaskJob, deps: TaskDeps): Promise<Embed> {
  const { author } = job
  const crewId = job.crewId
  const label = job.label
  if (!crewId || !label) return makeEmbed('error', 'Pick a crew from the list.', undefined, { author })
  const source = await deps.crewSource(crewId)
  if (source === 'unknown') return makeEmbed('error', 'Pick a crew from the list.', undefined, { author })
  // Permission first, then the source, like the crew page editor: non-leads learn nothing about storage.
  if (!(await deps.canManageCrew(job.discordId, crewId))) {
    return makeEmbed('error', "Only this crew's leads and admins can add tasks.", `Suggest it in the crew's channel, or open ${link('the crew page', crewUrl(deps.appUrl, crewId))}.`, { author })
  }
  if (source === 'sheet') {
    return makeEmbed('error', "This crew's tasks are still kept in its Google Sheet. Add it there for now.", link('Open the crew page', crewUrl(deps.appUrl, crewId)), { author })
  }
  const labels = await deps.crewLabels()
  const dup = await deps.findOpenDuplicate(crewId, label)
  if (dup) return renderDuplicate(dup, deps.appUrl, labels, author)
  const input = { label, priority: job.priority ?? null, due: job.due ?? null }
  try {
    // No transaction handle: createCrewTask invalidates the crew mappings cache itself. Crew pages read
    // tasks uncached and a new task has no lead, so nothing else needs refreshing.
    const id = await deps.create(crewId, input, job.discordId, { via: 'discord', ...(job.interactionId ? { interactionId: job.interactionId } : {}) })
    return renderAdded({ id, crewId, label, priority: input.priority, due: input.due }, deps.appUrl, labels, author)
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await deps.findOpenDuplicate(crewId, label)
      if (raced) return renderDuplicate(raced, deps.appUrl, labels, author)
    }
    throw err
  }
}

/** Friendlier wording for the refusals claimCrewTask returns (the rest are shown as they are). */
function friendly(status: number, sub: 'claim' | 'drop', message: string): string {
  if (status === 409 && sub === 'claim') return /closed/i.test(message) ? 'That task is closed.' : 'Someone else signed up for it, or it was closed.'
  if (status === 403 && sub === 'drop') return 'You can only drop tasks you lead.'
  if (status === 404) return "That task isn't available any more. Pick one from the list."
  return message
}

/** Build the reply for a job. Pure apart from the injected deps. */
export async function buildTaskReply(job: TaskJob, deps: TaskDeps): Promise<Embed> {
  const { author } = job
  if (!(await deps.isMember(job.discordId))) {
    return makeEmbed('error', 'Finish onboarding first.', `Join PizzaDAO at ${link(deps.appUrl.replace(/^https?:\/\//, ''), deps.appUrl)}, then you can sign up for tasks.`, { author })
  }

  switch (job.sub) {
    case 'list': {
      const [rows, labels] = await Promise.all([deps.openTasks(job.crewId), deps.crewLabels()])
      return renderList(rows, deps.appUrl, labels, job.crewId, author)
    }
    case 'mine': {
      const [rows, labels] = await Promise.all([deps.myTasks(job.discordId), deps.crewLabels()])
      return renderMine(rows, deps.appUrl, labels, author)
    }
    case 'claim': {
      if (!job.taskId) return makeEmbed('error', 'Pick a task to sign up for.', undefined, { author })
      const r = await deps.claim(job.discordId, job.taskId)
      if (r.ok) return renderClaimed(r.task ?? { label: 'that task', crewId: '' }, deps.appUrl, await deps.crewLabels(), author)
      if (r.status < 500) return makeEmbed('error', friendly(r.status, 'claim', r.error), undefined, { author })
      throw new Error(r.error)
    }
    case 'drop': {
      if (!job.taskId) return makeEmbed('error', 'Pick a task to drop.', undefined, { author })
      const r = await deps.drop(job.discordId, job.taskId)
      if (r.ok) return renderDropped(r.task ?? { label: 'that task' }, author)
      if (r.status < 500) return makeEmbed('error', friendly(r.status, 'drop', r.error), undefined, { author })
      throw new Error(r.error)
    }
    case 'add':
      return addTask(job, deps)
  }
}

async function editOriginal(job: TaskJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(job.applicationId)}/${encodeURIComponent(job.token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /task reply`)
}

/** Build the reply and edit the deferred message. Never throws. */
export async function runTaskCommand(job: TaskJob, deps: TaskDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    await editOriginal(job, await buildTaskReply(job, deps), fetchImpl)
  } catch (err) {
    console.error(`[/task ${job.sub}] failed:`, err instanceof Error ? err.message : String(err))
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch {
      // the token may have expired; nothing more to do
    }
  }
}
