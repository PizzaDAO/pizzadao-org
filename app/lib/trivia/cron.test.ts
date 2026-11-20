// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: vi.fn() }));
vi.mock("./channel", () => ({ resolveTriviaChannel: vi.fn(), triviaSettings: vi.fn() }));
vi.mock("./rounds", () => ({
  defaultPostDeps: { post: vi.fn() },
  expireRounds: vi.fn(async () => 0),
  findOpenRound: vi.fn(async () => null),
  openDiscordRound: vi.fn(),
  recentDiscordRounds: vi.fn(async () => []),
}));

import { toggleEnabled } from "@/app/lib/settings/toggles";
import { runTriviaCron } from "./cron";
import { isProductionDeploy, triviaLive } from "./enabled";
import { resolveTriviaChannel, triviaSettings } from "./channel";
import { expireRounds, findOpenRound, openDiscordRound, recentDiscordRounds } from "./rounds";
import { slotsForDay } from "./schedule";

const toggle = vi.mocked(toggleEnabled);
const CHAN = "840000000000000001";
const SLOT_DAY = "2026-12-10";
const slot = slotsForDay(SLOT_DAY, 3)[0];
const DUE = new Date(slot + 120_000);
const post = { post: vi.fn() };

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  toggle.mockReset();
  toggle.mockResolvedValue(true);
  vi.mocked(resolveTriviaChannel).mockReset();
  vi.mocked(resolveTriviaChannel).mockResolvedValue(CHAN);
  vi.mocked(triviaSettings).mockReset();
  vi.mocked(triviaSettings).mockResolvedValue({ rewardPep: 20, webDailyRewardPep: 0, dryRun: false, roundsPerDay: 3 });
  vi.mocked(expireRounds).mockClear();
  vi.mocked(findOpenRound).mockReset();
  vi.mocked(findOpenRound).mockResolvedValue(null);
  vi.mocked(openDiscordRound).mockReset();
  vi.mocked(openDiscordRound).mockResolvedValue({ ok: true, roundId: 5, questionId: "pd-001", messageId: "9" });
  vi.mocked(recentDiscordRounds).mockReset();
  vi.mocked(recentDiscordRounds).mockResolvedValue([]);
});
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

describe("the cron is a no-op unless production AND enabled", () => {
  it.each(["preview", "development", undefined])("VERCEL_ENV=%s: skipped, nothing read, posted or paid, even with the switch on", async (env) => {
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
    const r = await runTriviaCron(DUE, post);
    expect(r).toEqual({ status: "skipped", reason: "discord trivia off on preview" });
    expect(toggle).not.toHaveBeenCalled();
    expect(resolveTriviaChannel).not.toHaveBeenCalled();
    expect(expireRounds).not.toHaveBeenCalled();
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("production with the switch off: skipped", async () => {
    toggle.mockResolvedValue(false);
    expect(await runTriviaCron(DUE, post)).toEqual({ status: "skipped", reason: "trivia.enabled is off" });
    expect(openDiscordRound).not.toHaveBeenCalled();
    expect(expireRounds).not.toHaveBeenCalled();
  });

  it("an unreadable switch means off", async () => {
    toggle.mockRejectedValue(new Error("db down"));
    expect(await runTriviaCron(DUE, post)).toMatchObject({ status: "skipped" });
  });

  it("production, on, but no channel: skipped", async () => {
    vi.mocked(resolveTriviaChannel).mockResolvedValue(null);
    expect(await runTriviaCron(DUE, post)).toMatchObject({ status: "skipped" });
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("the gate itself", async () => {
    expect(isProductionDeploy({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeploy({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionDeploy({})).toBe(false);
    expect(await triviaLive({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("the tick", () => {
  it("expires first, then opens the due slot with the configured reward", async () => {
    vi.mocked(expireRounds).mockResolvedValue(1);
    const r = await runTriviaCron(DUE, post);
    expect(r).toEqual({ status: "ok", expired: 1, opened: "opened", roundId: 5, dryRun: false });
    expect(openDiscordRound).toHaveBeenCalledWith({ now: DUE, channelId: CHAN, rewardPep: 20 }, post);
  });

  it("a dry run opens the round with no reward", async () => {
    vi.mocked(triviaSettings).mockResolvedValue({ rewardPep: 20, webDailyRewardPep: 0, dryRun: true, roundsPerDay: 3 });
    await runTriviaCron(DUE, post);
    expect(openDiscordRound).toHaveBeenCalledWith(expect.objectContaining({ rewardPep: 0 }), post);
  });

  it("does nothing between slots", async () => {
    const r = await runTriviaCron(new Date(slot - 5 * 60_000), post);
    expect(r).toMatchObject({ status: "ok", opened: "not_due" });
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("a slot already fired (a round opened since) does not fire again", async () => {
    vi.mocked(recentDiscordRounds).mockResolvedValue([{ questionId: "pd-001", openedAt: new Date(slot + 30_000), postFailed: false }]);
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "not_due" });
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("a skipped (cancelled but asked) round does not re-open its slot, a failed post gets one retry", async () => {
    vi.mocked(recentDiscordRounds).mockResolvedValue([{ questionId: "pd-001", openedAt: new Date(slot + 30_000), postFailed: false }]);
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "not_due" });
    vi.mocked(recentDiscordRounds).mockResolvedValue([{ questionId: "pd-001", openedAt: new Date(slot + 30_000), postFailed: true }]);
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "opened" });
    vi.mocked(recentDiscordRounds).mockResolvedValue([
      { questionId: "pd-001", openedAt: new Date(slot + 90_000), postFailed: true },
      { questionId: "pd-002", openedAt: new Date(slot + 30_000), postFailed: true },
    ]);
    vi.mocked(openDiscordRound).mockClear();
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "not_due" });
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("never opens a second round while one is open", async () => {
    vi.mocked(findOpenRound).mockResolvedValue({ id: 1 } as never);
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "open_round" });
    expect(openDiscordRound).not.toHaveBeenCalled();
  });

  it("reports a refused open (lost the race, no question, post failed) without throwing", async () => {
    vi.mocked(openDiscordRound).mockResolvedValue({ ok: false, reason: "open_exists" });
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "open_round" });
    vi.mocked(openDiscordRound).mockResolvedValue({ ok: false, reason: "post_failed" });
    expect(await runTriviaCron(DUE, post)).toMatchObject({ opened: "post_failed" });
  });
});
