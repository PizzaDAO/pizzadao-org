// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), sendDM: vi.fn(), search: vi.fn() }));
vi.mock('./db', () => ({ prisma: { magicLoginToken: mocks } }));
vi.mock('./discord', () => ({ searchGuildMembers: mocks.search, sendDM: mocks.sendDM }));
vi.mock('./activation', () => ({ recordActivationLater: vi.fn() }));
import { requestMagicLogin, verifyMagicToken } from './magic-login';
beforeEach(() => {
  vi.clearAllMocks(); mocks.count.mockResolvedValue(0); mocks.search.mockResolvedValue([{ user: { id: 'verified-user', username: 'test_member' }, nick: 'Member' }]); mocks.sendDM.mockResolvedValue({ success: true }); mocks.deleteMany.mockResolvedValue({ count: 0 }); mocks.updateMany.mockResolvedValue({ count: 1 });
});
describe('DM signup handoff', () => {
  it('stores only an allowlisted draft against the resolved Discord identity', async () => {
    await requestMagicLogin('test_member', 'https://app.example', { onboarding: true, signupDraft: { mafiaName: 'Test', city: 'Paris', sessionId: 'test-session', discordId: 'attacker', isAdmin: true } });
    const { data } = mocks.create.mock.calls[0][0];
    expect(data.discordId).toBe('verified-user'); expect(data.signupDraft).not.toHaveProperty('discordId');
    expect(data).not.toHaveProperty('rawToken'); expect(mocks.sendDM.mock.calls[0][0]).toBe('verified-user');
  });
  it('returns the draft only after a successful atomic token claim', async () => {
    mocks.findUnique.mockResolvedValue({ discordId: 'verified-user', username: 'member', nick: null, usedAt: null, expiresAt: new Date(Date.now() + 60000), signupDraft: { mafiaName: 'Test', city: 'Paris', sessionId: 'test-session' } });
    const verified = await verifyMagicToken('raw-test-token'); expect(verified).toMatchObject({ valid: true, discordId: 'verified-user', draft: { city: 'Paris' } });
    mocks.updateMany.mockResolvedValue({ count: 0 }); expect(await verifyMagicToken('raw-test-token')).toEqual({ valid: false, reason: 'used' });
  });
  it('does not reveal a draft from an expired token', async () => {
    mocks.findUnique.mockResolvedValue({ usedAt: null, expiresAt: new Date(0), signupDraft: { city: 'Paris' } });
    expect(await verifyMagicToken('expired')).toEqual({ valid: false, reason: 'expired' }); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('deletes an undelivered login token and its draft', async () => {
    mocks.sendDM.mockResolvedValue({ success: false, error: 'dms_disabled' });
    expect((await requestMagicLogin('test_member', 'https://app.example')).status).toBe('dm_failed'); expect(mocks.delete).toHaveBeenCalled();
  });
});
