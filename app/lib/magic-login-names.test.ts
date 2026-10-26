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
  it('does not trust a single nick match when the search hit its limit', async () => {
    const full = Array.from({ length: 99 }, (_, i) => mem(`f${i}`, `filler${i}`));
    mocks.search.mockResolvedValue([...full, mem('1', 'mush42', { nick: 'Mushroom Tarantino' })]);
    expect((await requestMagicLogin('mushroom tarantino', 'https://app.example')).status).toBe('ambiguous');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('still accepts an exact username within a full result set', async () => {
    const full = Array.from({ length: 99 }, (_, i) => mem(`f${i}`, `filler${i}`));
    mocks.search.mockResolvedValue([...full, mem('1', 'mush42')]);
    expect((await requestMagicLogin('mush42', 'https://app.example')).status).toBe('sent');
    expect(dmTo()).toEqual(['1']);
  });
  it('returns lookup_failed when the Discord search errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.search.mockRejectedValue(new Error('discord_member_search_500'));
    expect((await requestMagicLogin('anyone', 'https://app.example')).status).toBe('lookup_failed');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('returns not_found when nothing matches', async () => {
    mocks.search.mockResolvedValue([mem('1', 'someone', { nick: 'Other' })]);
    expect((await requestMagicLogin('nobody', 'https://app.example')).status).toBe('not_found');
    expect((await requestMagicLogin('@', 'https://app.example')).status).toBe('not_found');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('matches a nickname that has a trailing emoji (Discord prefix search still returns it)', async () => {
    mocks.search.mockResolvedValue([mem('1', 'enzo42', { nick: 'Enzo Pepperoni \u{1F36B}' })]);
    expect((await requestMagicLogin('Enzo Pepperoni', 'https://app.example')).status).toBe('sent');
    expect(mocks.search).toHaveBeenCalledWith('Enzo Pepperoni', 100);
    expect(dmTo()).toEqual(['1']);
  });
  it('matches a global_name with emoji, ZWJ and skin tones', async () => {
    mocks.search.mockResolvedValue([mem('1', 'x1', { user: { global_name: 'Enzo \u{1F468}\u{1F3FD}\u200D\u{1F373} Pepperoni \u2764\uFE0F' } })]);
    expect((await requestMagicLogin('enzo pepperoni', 'https://app.example')).status).toBe('sent');
    expect(dmTo()).toEqual(['1']);
  });
  it('matches when the user types the emoji too', async () => {
    mocks.search.mockResolvedValue([mem('1', 'x1', { nick: '\u{1F36B} Enzo' })]);
    expect((await requestMagicLogin('\u{1F36B} Enzo', 'https://app.example')).status).toBe('sent');
  });
  it('never matches emoji-only names', async () => {
    mocks.search.mockResolvedValue([mem('1', 'a1', { nick: '\u{1F36B}\u{1F355}' }), mem('2', 'a2', { user: { global_name: '\u{1F355}' } })]);
    expect((await requestMagicLogin('\u{1F36B}\u{1F355}', 'https://app.example')).status).toBe('not_found');
    expect((await requestMagicLogin('\u{1F355}', 'https://app.example')).status).toBe('not_found');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('is ambiguous when loose forms collide', async () => {
    mocks.search.mockResolvedValue([mem('1', 'a1', { nick: 'Enzo Pepperoni \u{1F36B}' }), mem('2', 'a2', { nick: 'Enzo Pepperoni \u{1F355}' })]);
    expect((await requestMagicLogin('Enzo Pepperoni', 'https://app.example')).status).toBe('ambiguous');
    expect(mocks.sendDM).not.toHaveBeenCalled();
  });
  it('still treats a truncated result set as ambiguous for emoji-loose matches', async () => {
    const full = Array.from({ length: 99 }, (_, i) => mem(`f${i}`, `filler${i}`));
    mocks.search.mockResolvedValue([...full, mem('1', 'e', { nick: 'Enzo Pepperoni \u{1F36B}' })]);
    expect((await requestMagicLogin('Enzo Pepperoni', 'https://app.example')).status).toBe('ambiguous');
  });
});
