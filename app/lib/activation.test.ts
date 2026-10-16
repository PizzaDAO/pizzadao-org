// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), findFirst: vi.fn() }));
vi.mock('./db', () => ({ prisma: { activationEvent: mocks } }));
import { recordActivation } from './activation';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('SESSION_SECRET', 'test-secret'); mocks.findFirst.mockResolvedValue({ actor: 'signup-journey' }); });
describe('activation events', () => {
  it('deduplicates stages and hashes the member identity', async () => {
    await recordActivation('profile_created', { actor: 'signup-journey', discordId: '123456789012345678' });
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ actor_event_code: { actor: 'signup-journey', event: 'profile_created', code: '' } });
    expect(args.create.memberKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain('123456789012345678');
  });
  it('attributes a later contribution to the original signup cohort', async () => {
    await recordActivation('first_contribution', { discordId: '123', code: 'task_claim' });
    expect(mocks.upsert.mock.calls[0][0].create.actor).toBe('signup-journey');
  });
  it('does not propagate telemetry failures', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('offline'));
    await expect(recordActivation('signup_started', { actor: 'test-session' })).resolves.toBeUndefined();
  });
});
