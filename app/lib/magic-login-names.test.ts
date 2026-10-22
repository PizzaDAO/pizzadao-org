// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), count: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), sendDM: vi.fn(), search: vi.fn() }));
vi.mock('./db', () => ({ prisma: { magicLoginToken: mocks } }));
vi.mock('./discord', () => ({ searchGuildMembers: mocks.search, sendDM: mocks.sendDM }));
vi.mock('./activation', () => ({ recordActivationLater: vi.fn() }));
import { requestMagicLogin } from './magic-login';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  mocks.sendDM.mockResolvedValue({ success: true });
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

const mem = (id: string, username: string, extra: { nick?: string; user?: Record<string, unknown> } = {}) => ({
  user: { id, username, ...extra.user },
  nick: extra.nick,
  roles: [],
});
const dmTo = () => mocks.sendDM.mock.calls.map((c) => c[0]);

describe('login name matching', () => {
  it('matches exact username case-insensitively and with a leading @', async () => {
    mocks.search.mockResolvedValue([mem('1', 'Mushroom')]);
    expect((await requestMagicLogin('  @mushroom ', 'https://app.example')).status).toBe('sent');
    expect(dmTo()).toEqual(['1']);
    expect(mocks.search).toHaveBeenCalledWith('mushroom', 100);
  });
  it('prefers the exact username over a nickname collision', async () => {
    mocks.search.mockResolvedValue([mem('1', 'other', { nick: 'bob' }), mem('2', 'bob')]);
    await requestMagicLogin('bob', 'https://app.example');
    expect(dmTo()).toEqual(['2']);
  });
  it('matches a server nickname, whitespace-normalized', async () => {
    mocks.search.mockResolvedValue([mem('1', 'mush42', { nick: 'Mushroom Tarantino' })]);
    expect((await requestMagicLogin('mushroom   tarantino', 'https://app.example')).status).toBe('sent');
    expect(dmTo()).toEqual(['1']);
  });
  it('matches global_name', async () => {
    mocks.search.mockResolvedValue([mem('1', 'mush42', { user: { global_name: 'Mushroom T' } })]);
    expect((await requestMagicLogin('mushroom t', 'https://app.example')).status).toBe('sent');
    expect(dmTo()).toEqual(['1']);
  });
  it('does not match the Pizza Trainee placeholder', async () => {
    mocks.search.mockResolvedValue([mem('1', 'a1', { nick: 'Pizza Trainee' }), mem('2', 'a2', { nick: 'Pizza Trainee' })]);
    expect((await requestMagicLogin('Pizza Trainee', 'https://app.example')).status).toBe('not_found');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('returns ambiguous and sends no DM when several members match', async () => {
    mocks.search.mockResolvedValue([mem('1', 'a1', { nick: 'Sam' }), mem('2', 'a2', { user: { global_name: 'sam' } })]);
    expect((await requestMagicLogin('Sam', 'https://app.example')).status).toBe('ambiguous');
    expect(mocks.sendDM).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('never matches bots', async () => {
    mocks.search.mockResolvedValue([mem('1', 'helper', { user: { bot: true } })]);
    expect((await requestMagicLogin('helper', 'https://app.example')).status).toBe('not_found');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('returns not_found when nothing matches', async () => {
    mocks.search.mockResolvedValue([mem('1', 'someone', { nick: 'Other' })]);
    expect((await requestMagicLogin('nobody', 'https://app.example')).status).toBe('not_found');
    expect((await requestMagicLogin('@', 'https://app.example')).status).toBe('not_found');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
});
