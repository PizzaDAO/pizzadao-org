// Characterization tests for POST /api/claim-task. They pin the current behavior of both the
// database and the Google Sheets paths, and must stay unchanged across the claim-task extraction.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getCrewMappings: vi.fn(),
  usesDb: vi.fn(),
  fetchMemberByDiscordId: vi.fn(),
  fetchMemberIdByDiscordId: vi.fn(),
  recordActivation: vi.fn(),
  sheetsGet: vi.fn(),
  sheetsUpdate: vi.fn(),
  prisma: {
    crewTask: { findMany: vi.fn(), updateMany: vi.fn() },
    crewTaskEvent: { create: vi.fn() },
    taskClaimEvent: { upsert: vi.fn() },
  },
}))

vi.mock('@/app/lib/auth-guards', () => ({ requireSession: m.requireSession }))
vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: m.getCrewMappings, isClosedStage: (s: string) => ['done', 'skip', 'complete', 'completed'].includes(s.trim().toLowerCase()) }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: m.usesDb }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberByDiscordId: m.fetchMemberByDiscordId,
  fetchMemberIdByDiscordId: m.fetchMemberIdByDiscordId,
}))
vi.mock('@/app/lib/activation', () => ({ recordActivationLater: m.recordActivation }))
vi.mock('@/app/lib/google-auth', () => ({ getGoogleAuth: () => ({}), GOOGLE_SCOPES: { sheets: 'sheets' } }))
vi.mock('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { get: m.sheetsGet, values: { update: m.sheetsUpdate } } }) },
}))

import { POST } from '../route'

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/SHEET123/edit'
const post = (body: unknown) => POST(new Request('http://x/api/claim-task', { method: 'POST', body: JSON.stringify(body) }))
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

const cell = (v: string) => ({ userEnteredValue: { stringValue: v } })
function sheetWith(rows: string[][]) {
  return { data: { sheets: [{ properties: { title: 'Tab' }, data: [{ rowData: rows.map((r) => ({ values: r.map(cell) })) }] }] } }
}
const HEADER = ['Task', 'Stage', 'Lead', 'Lead ID']

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.requireSession.mockResolvedValue({ ok: true, session: { discordId: 'd1' } })
  m.getCrewMappings.mockResolvedValue({ crews: [{ id: 'kitchen', label: 'Kitchen', sheet: SHEET_URL }, { id: 'nosheet', label: 'No sheet' }] })
  m.usesDb.mockResolvedValue(true)
  m.fetchMemberByDiscordId.mockResolvedValue({ memberId: 42, name: 'Mario' })
  m.fetchMemberIdByDiscordId.mockResolvedValue(42)
  m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: ' Bake bread ', leadMemberId: null }])
  m.prisma.crewTask.updateMany.mockResolvedValue({ count: 1 })
  m.prisma.crewTaskEvent.create.mockResolvedValue({})
  m.prisma.taskClaimEvent.upsert.mockResolvedValue({})
})

describe('claim-task: invalid action', () => {
  it('400s', async () => {
    expect(await json(await post({ crewId: 'kitchen', taskName: 'x', action: 'steal' }))).toEqual({ status: 400, body: { error: 'Invalid action' } })
  })
})

describe('claim-task: database path', () => {
  it('claims: conditional update, event, claim key with the sheet id, activation', async () => {
    const r = await json(await post({ crewId: 'kitchen', sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))
    expect(r).toEqual({ status: 200, body: { success: true, action: 'claim' } })
    expect(m.prisma.crewTask.findMany).toHaveBeenCalledWith({ where: { crewId: 'kitchen', archived: false }, select: { id: true, label: true, leadMemberId: true, stage: true } })
    expect(m.prisma.crewTask.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', OR: [{ leadMemberId: null }, { leadMemberId: '' }, { leadMemberId: '42' }] },
      data: { leadMemberId: '42', leadName: 'Mario', updatedBy: 'd1' },
    })
    expect(m.prisma.crewTaskEvent.create).toHaveBeenCalledWith({ data: { taskId: 't1', crewId: 'kitchen', action: 'claim', actor: 'd1' } })
    expect(m.prisma.taskClaimEvent.upsert).toHaveBeenCalledWith({
      where: { memberId_taskKey: { memberId: '42', taskKey: 'SHEET123::Bake bread' } },
      update: {},
      create: { memberId: '42', taskKey: 'SHEET123::Bake bread', taskName: 'Bake bread', sheetUrl: SHEET_URL },
    })
    expect(m.recordActivation).toHaveBeenCalledWith('first_contribution', { discordId: 'd1', code: 'task_claim' })
  })

  it('refuses to claim a task that is already Done (it must not count for the crew task mission)', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: 'Bake bread', leadMemberId: null, stage: 'Done' }])
    const r = await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))
    expect(r).toEqual({ status: 409, body: { error: 'That task is closed' } })
    expect(m.prisma.crewTask.updateMany).not.toHaveBeenCalled()
    expect(m.prisma.crewTaskEvent.create).not.toHaveBeenCalled()
  })

  it('claims the open task when a closed one shares its label', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([
      { id: 't0', label: 'Bake bread', leadMemberId: null, stage: 'Done' },
      { id: 't1', label: 'Bake bread', leadMemberId: null, stage: 'todo' },
    ])
    expect((await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))).status).toBe(200)
    expect(m.prisma.crewTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 't1' }) }))
  })

  it('uses the crew: key prefix when the crew has no sheet', async () => {
    await post({ crewId: 'nosheet', taskName: 'Bake bread', action: 'claim' })
    expect(m.prisma.taskClaimEvent.upsert).toHaveBeenCalledWith({
      where: { memberId_taskKey: { memberId: '42', taskKey: 'crew:nosheet::Bake bread' } },
      update: {},
      create: { memberId: '42', taskKey: 'crew:nosheet::Bake bread', taskName: 'Bake bread', sheetUrl: null },
    })
  })

  it('finds the crew by sheetUrl when there is no crewId', async () => {
    const r = await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))
    expect(r.status).toBe(200)
    expect(m.prisma.crewTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { crewId: 'kitchen', archived: false } }))
  })

  it('409s when someone else leads the task', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: 'Bake bread', leadMemberId: '7' }])
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))).toEqual({ status: 409, body: { error: 'Task is already claimed by another member' } })
    expect(m.prisma.crewTask.updateMany).not.toHaveBeenCalled()
  })

  it('409s when the conditional update loses the race', async () => {
    m.prisma.crewTask.updateMany.mockResolvedValue({ count: 0 })
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))).toEqual({ status: 409, body: { error: 'Task is already claimed by another member' } })
    expect(m.prisma.crewTaskEvent.create).not.toHaveBeenCalled()
    expect(m.recordActivation).not.toHaveBeenCalled()
  })

  it('403s giving up a task you do not lead', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: 'Bake bread', leadMemberId: '7' }])
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'giveup' }))).toEqual({ status: 403, body: { error: 'You can only give up tasks you lead' } })
  })

  it('gives up your own task: clears the lead, logs the event, no claim event or activation', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: 'Bake bread', leadMemberId: '42' }])
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'giveup' }))).toEqual({ status: 200, body: { success: true, action: 'giveup' } })
    expect(m.prisma.crewTask.updateMany).toHaveBeenCalledWith({ where: { id: 't1', leadMemberId: '42' }, data: { leadMemberId: null, leadName: null, updatedBy: 'd1' } })
    expect(m.prisma.crewTaskEvent.create).toHaveBeenCalledWith({ data: { taskId: 't1', crewId: 'kitchen', action: 'giveup', actor: 'd1' } })
    expect(m.prisma.taskClaimEvent.upsert).not.toHaveBeenCalled()
    expect(m.recordActivation).not.toHaveBeenCalled()
  })

  it('403s a give-up whose conditional update matches nothing', async () => {
    m.prisma.crewTask.findMany.mockResolvedValue([{ id: 't1', label: 'Bake bread', leadMemberId: '42' }])
    m.prisma.crewTask.updateMany.mockResolvedValue({ count: 0 })
    expect((await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'giveup' }))).status).toBe(403)
  })

  it('403s when no member profile is linked', async () => {
    m.fetchMemberByDiscordId.mockResolvedValue(null)
    m.fetchMemberIdByDiscordId.mockResolvedValue(null)
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))).toEqual({
      status: 403,
      body: { error: 'No member profile is linked to your Discord account' },
    })
  })

  it('falls back to the member id lookup when the member record is missing', async () => {
    m.fetchMemberByDiscordId.mockResolvedValue(null)
    await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' })
    expect(m.prisma.crewTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { leadMemberId: '42', leadName: null, updatedBy: 'd1' } }))
  })

  it('404s an unknown label', async () => {
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Nope', action: 'claim' }))).toEqual({ status: 404, body: { error: 'Task not found' } })
  })

  it('still returns 200 when the event writes fail', async () => {
    m.prisma.crewTaskEvent.create.mockRejectedValue(new Error('db'))
    m.prisma.taskClaimEvent.upsert.mockRejectedValue(new Error('db'))
    expect(await json(await post({ crewId: 'kitchen', taskName: 'Bake bread', action: 'claim' }))).toEqual({ status: 200, body: { success: true, action: 'claim' } })
    expect(m.recordActivation).toHaveBeenCalled()
  })

  it('defaults the action to claim', async () => {
    expect((await json(await post({ crewId: 'kitchen', taskName: 'Bake bread' }))).body).toEqual({ success: true, action: 'claim' })
  })
})

describe('claim-task: sheet path', () => {
  beforeEach(() => {
    m.usesDb.mockResolvedValue(false)
    m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', 'Doing', '', '']]))
    m.sheetsUpdate.mockResolvedValue({})
  })

  it('refuses to claim a sheet task whose stage is Done or Skip, but lets the lead give it up', async () => {
    for (const stage of ['Done', 'skip']) {
      m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', stage, '', '']]))
      expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))).toEqual({ status: 409, body: { error: 'That task is closed' } })
    }
    expect(m.sheetsUpdate).not.toHaveBeenCalled()
    m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', 'Done', '', '42']]))
    expect((await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'giveup' }))).status).toBe(200)
  })

  it('400s on missing fields', async () => {
    expect(await json(await post({ sheetUrl: SHEET_URL, action: 'claim' }))).toEqual({ status: 400, body: { error: 'Missing required fields' } })
    expect((await json(await post({ taskName: 'x', action: 'claim' }))).status).toBe(400)
  })

  it('403s when no member is linked', async () => {
    m.fetchMemberIdByDiscordId.mockResolvedValue(null)
    expect((await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread' }))).status).toBe(403)
  })

  it('400s a bad sheet URL', async () => {
    expect(await json(await post({ sheetUrl: 'https://example.com/nope', taskName: 'Bake bread' }))).toEqual({ status: 400, body: { error: 'Invalid sheet URL' } })
  })

  it('403s a sheet that is not a configured crew sheet', async () => {
    expect(await json(await post({ sheetUrl: 'https://docs.google.com/spreadsheets/d/OTHER/edit', taskName: 'Bake bread' }))).toEqual({
      status: 403,
      body: { error: 'Sheet is not a configured crew sheet' },
    })
  })

  it('404s a task that is not in the sheet', async () => {
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Nope' }))).toEqual({ status: 404, body: { error: 'Task not found in sheet' } })
  })

  it('500s without a Lead ID column', async () => {
    m.sheetsGet.mockResolvedValue(sheetWith([['Task', 'Stage', 'Lead'], ['Bake bread', 'Doing', '']]))
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread' }))).toEqual({ status: 500, body: { error: 'Lead ID column not found in sheet' } })
  })

  it('500s without a Lead column', async () => {
    m.sheetsGet.mockResolvedValue(sheetWith([['Task', 'Stage', 'Lead ID'], ['Bake bread', 'Doing', '']]))
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread' }))).toEqual({ status: 500, body: { error: 'Lead column not found in sheet' } })
  })

  it('claim writes the member id into the Lead ID cell, logs the event and the activation', async () => {
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))).toEqual({ status: 200, body: { success: true, action: 'claim' } })
    expect(m.sheetsUpdate).toHaveBeenCalledWith({ spreadsheetId: 'SHEET123', range: "'Tab'!D2", valueInputOption: 'RAW', requestBody: { values: [[42]] } })
    expect(m.prisma.taskClaimEvent.upsert).toHaveBeenCalledWith({
      where: { memberId_taskKey: { memberId: 42, taskKey: 'SHEET123::Bake bread' } },
      update: {},
      create: { memberId: 42, taskKey: 'SHEET123::Bake bread', taskName: 'Bake bread', sheetUrl: SHEET_URL },
    })
    expect(m.recordActivation).toHaveBeenCalledWith('first_contribution', { discordId: 'd1', code: 'task_claim' })
  })

  it('give-up writes an empty Lead ID, with no claim event or activation', async () => {
    m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', 'Doing', 'Mario', '42']]))
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'giveup' }))).toEqual({ status: 200, body: { success: true, action: 'giveup' } })
    expect(m.sheetsUpdate).toHaveBeenCalledWith(expect.objectContaining({ range: "'Tab'!D2", requestBody: { values: [['']] } }))
    expect(m.prisma.taskClaimEvent.upsert).not.toHaveBeenCalled()
    expect(m.recordActivation).not.toHaveBeenCalled()
  })

  it('409s a claim of a task another member leads', async () => {
    m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', 'Doing', 'Luigi', '7']]))
    expect(await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))).toEqual({
      status: 409,
      body: { error: 'Task is already claimed by another member' },
    })
    expect(m.sheetsUpdate).not.toHaveBeenCalled()
  })

  it('403s a give-up of a task you do not lead', async () => {
    m.sheetsGet.mockResolvedValue(sheetWith([HEADER, ['Bake bread', 'Doing', 'Luigi', '7']]))
    expect((await json(await post({ sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'giveup' }))).status).toBe(403)
  })

  it('an unknown crewId falls through to the sheet path', async () => {
    const r = await json(await post({ crewId: 'ghost', sheetUrl: SHEET_URL, taskName: 'Bake bread', action: 'claim' }))
    expect(r.status).toBe(200)
    expect(m.sheetsUpdate).toHaveBeenCalled()
  })
})
