import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  canManageCrew: vi.fn(),
  getSetting: vi.fn(),
  toggleEnabled: vi.fn(),
  findUnique: vi.fn(),
  getPublicSession: vi.fn(),
  cancelSession: vi.fn(),
  editSession: vi.fn(),
  retrySession: vi.fn(),
}))
vi.mock('@/app/lib/session', () => ({ getSession: m.getSession }))
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew: m.canManageCrew }))
vi.mock('@/app/lib/settings', () => ({ getSetting: m.getSetting }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggleEnabled }))
vi.mock('@/app/lib/db', () => ({ prisma: { crewSession: { findUnique: m.findUnique } } }))
vi.mock('./public', () => ({ getPublicSession: m.getPublicSession }))
vi.mock('./run', () => ({ cancelSession: m.cancelSession, editSession: m.editSession, retrySession: m.retrySession }))

import { NextRequest } from 'next/server'
import { GET as icsGet } from '@/app/api/public/sessions/[id]/ics/route'
import { POST as cancelPost } from '@/app/api/crew/[crewId]/sessions/[sessionId]/cancel/route'
import { PATCH as editPatch } from '@/app/api/crew/[crewId]/sessions/[sessionId]/route'
import { POST as retryPost } from '@/app/api/crew/[crewId]/sessions/[sessionId]/retry/route'

const req = (body?: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: body ? JSON.stringify(body) : undefined })
const ctx = (crewId = 'education', sessionId = 'sess00001') => ({ params: Promise.resolve({ crewId, sessionId }) })
const form = { title: 'T', presenter: '', description: 'D', date: '2099-01-01', time: '10:00', timeZone: 'UTC', lengthMinutes: 60 }

beforeEach(() => {
  vi.clearAllMocks()
  m.getSetting.mockResolvedValue(['education'])
  m.toggleEnabled.mockResolvedValue(true)
  m.getSession.mockResolvedValue({ discordId: 'lead1' })
  m.canManageCrew.mockResolvedValue(true)
  m.findUnique.mockResolvedValue({ crewId: 'education' })
  m.cancelSession.mockResolvedValue({ status: 'canceled' })
  m.editSession.mockResolvedValue({ status: 'edited' })
  m.retrySession.mockResolvedValue({ status: 'scheduled' })
})

describe('who may edit, cancel and retry', () => {
  it('a lead can', async () => {
    expect((await cancelPost(req(), ctx())).status).toBe(200)
    expect((await editPatch(req(form), ctx())).status).toBe(200)
    expect((await retryPost(req(), ctx())).status).toBe(200)
    expect(m.cancelSession).toHaveBeenCalledWith('sess00001', 'lead1')
  })
  it('a member who is not a lead gets 403 and nothing runs', async () => {
    m.canManageCrew.mockResolvedValue(false)
    expect((await cancelPost(req(), ctx())).status).toBe(403)
    expect((await editPatch(req(form), ctx())).status).toBe(403)
    expect((await retryPost(req(), ctx())).status).toBe(403)
    expect(m.cancelSession).not.toHaveBeenCalled()
    expect(m.editSession).not.toHaveBeenCalled()
    expect(m.retrySession).not.toHaveBeenCalled()
  })
  it('logged out gets 401', async () => {
    m.getSession.mockResolvedValue(null)
    expect((await cancelPost(req(), ctx())).status).toBe(401)
  })
  it('a lead of another crew cannot touch this crew\'s session (the id must belong to the crew in the URL)', async () => {
    m.getSetting.mockResolvedValue(['education', 'events'])
    m.findUnique.mockResolvedValue({ crewId: 'education' })
    expect((await cancelPost(req(), ctx('events'))).status).toBe(404)
    expect(m.cancelSession).not.toHaveBeenCalled()
  })
  it('an unknown session is 404; a crew outside the setting is 404', async () => {
    m.findUnique.mockResolvedValue(null)
    expect((await cancelPost(req(), ctx())).status).toBe(404)
    expect((await cancelPost(req(), ctx('design'))).status).toBe(404)
  })
  it('bad form input is a 400 and never reaches Discord code', async () => {
    expect((await editPatch(req({ ...form, title: '' }), ctx())).status).toBe(400)
    expect(m.editSession).not.toHaveBeenCalled()
  })
  it('maps outcomes to statuses', async () => {
    m.cancelSession.mockResolvedValue({ status: 'disabled' })
    expect((await cancelPost(req(), ctx())).status).toBe(409)
    m.editSession.mockResolvedValue({ status: 'ended' })
    expect((await editPatch(req(form), ctx())).status).toBe(409)
  })
  it('retry is refused while the edit switch is off', async () => {
    m.toggleEnabled.mockResolvedValue(false)
    expect((await retryPost(req(), ctx())).status).toBe(409)
    expect(m.retrySession).not.toHaveBeenCalled()
  })
})

describe('GET /api/public/sessions/<id>/ics', () => {
  const get = (id = 'sess00001') => icsGet(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id }) })
  const pub = { id: 'sess00001', title: 'Intro', presenter: null, description: 'D', startsAt: new Date('2099-01-01T10:00:00Z'), endsAt: new Date('2099-01-01T11:00:00Z'), timeZone: 'UTC', eventUrl: null, recordingUrl: null }
  it('returns a calendar file for a public session', async () => {
    m.getPublicSession.mockResolvedValue(pub)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    expect(await res.text()).toContain('SUMMARY:Intro')
  })
  it('404 when the listing is off, without even looking the session up', async () => {
    m.toggleEnabled.mockResolvedValue(false)
    expect((await get()).status).toBe(404)
    expect(m.getPublicSession).not.toHaveBeenCalled()
  })
  it('404 for a canceled, hidden or unknown session (the public lookup returns null)', async () => {
    m.getPublicSession.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })
  it('404 for a malformed id', async () => {
    expect((await get('../x')).status).toBe(404)
    expect(m.getPublicSession).not.toHaveBeenCalled()
  })
})
