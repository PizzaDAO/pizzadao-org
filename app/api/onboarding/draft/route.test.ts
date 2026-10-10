// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), findFirst: vi.fn(), get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get }) }));
vi.mock("@/app/lib/auth-guards", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/app/lib/db", () => ({ prisma: { magicLoginToken: { findFirst: mocks.findFirst } } }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks(); mocks.requireSession.mockResolvedValue({ ok: true, session: { discordId: 'verified-user' } }); mocks.get.mockReturnValue({ value: 'a'.repeat(64) });
});
describe('draft recovery', () => {
  it('requires authentication before reading stored data', async () => {
    mocks.requireSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET()).status).toBe(401); expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it('restricts lookup to the verified identity and a recently consumed token', async () => {
    mocks.findFirst.mockResolvedValue({ signupDraft: { mafiaName: 'Test', city: 'Paris', sessionId: 'test-session' } });
    const response = await GET();
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { tokenHash: 'a'.repeat(64), discordId: 'verified-user', usedAt: { gte: expect.any(Date) } } });
    const since = mocks.findFirst.mock.calls[0][0].where.usedAt.gte.getTime();
    expect(Date.now() - since).toBeLessThan(1801000); expect(Date.now() - since).toBeGreaterThanOrEqual(1800000);
    expect((await response.json()).draft.mafiaName).toBe('Test'); expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns no draft for another user, expired token, or cleared draft', async () => {
    mocks.findFirst.mockResolvedValue(null); expect(await (await GET()).json()).toEqual({ draft: null });
  });
  it('reports storage failures so the user can retry', async () => {
    mocks.findFirst.mockRejectedValue(new Error('db')); expect((await GET()).status).toBe(503);
  });
});
