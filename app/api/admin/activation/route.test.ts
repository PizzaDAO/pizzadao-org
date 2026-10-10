// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock('@/app/lib/auth-guards', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/app/lib/db', () => ({ prisma: { activationEvent: { findMany: mocks.findMany, deleteMany: mocks.deleteMany } } }));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ ok: true }); mocks.findMany.mockResolvedValue([]); mocks.deleteMany.mockResolvedValue({ count: 0 }); });
describe('activation report', () => {
  it('does not expose metrics to non-admins', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403); expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('counts only started cohort journeys once per stage and reports errors separately', async () => {
    mocks.findMany.mockResolvedValue([
      { actor: 'new', event: 'signup_started', code: '' },
      { actor: 'new', event: 'dm_sent', code: '' },
      { actor: 'returning', event: 'dm_sent', code: '' },
      { actor: 'new', event: 'first_contribution', code: 'task_claim' },
      { actor: 'new', event: 'first_contribution', code: 'mission_submission' },
      { actor: 'returning', event: 'login_failed', code: 'dm_failed' },
    ]);
    const response = await GET(); const report = await response.json();
    expect(report.stages.find((s: { event: string }) => s.event === 'dm_sent').count).toBe(1);
    expect(report.stages.find((s: { event: string }) => s.event === 'first_contribution').count).toBe(1);
    expect(report.failures).toEqual([{ code: 'login_failed:dm_failed', count: 1 }]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(report)).not.toContain('returning');
  });
});
