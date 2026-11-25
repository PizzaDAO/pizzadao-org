// @vitest-environment node
// resolveTriviaChannel: a saved id is a settings-cache read; an unsaved one is looked up once a minute, not per poll.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/settings", () => ({ loadSettings: vi.fn() }));
vi.mock("@/app/lib/settings/channels", () => ({
  savedChannelId: vi.fn(async () => ""),
  pinChannelId: vi.fn(async () => undefined),
  resolveConfiguredChannelDetailed: vi.fn(async () => ({ id: "c1", trusted: true })),
}));

import { pinChannelId, resolveConfiguredChannelDetailed, savedChannelId } from "@/app/lib/settings/channels";
import { resetTriviaChannelCache, resolveTriviaChannel } from "./channel";

beforeEach(() => {
  vi.useFakeTimers();
  resetTriviaChannelCache();
  vi.mocked(savedChannelId).mockReset();
  vi.mocked(savedChannelId).mockResolvedValue("");
  vi.mocked(resolveConfiguredChannelDetailed).mockClear();
  vi.mocked(pinChannelId).mockClear();
});
afterEach(() => vi.useRealTimers());

describe("resolveTriviaChannel", () => {
  it("a saved id is returned without any lookup", async () => {
    vi.mocked(savedChannelId).mockResolvedValue("saved");
    expect(await resolveTriviaChannel()).toBe("saved");
    expect(resolveConfiguredChannelDetailed).not.toHaveBeenCalled();
  });

  it("an unsaved channel is looked up once per minute, and in-flight calls are shared", async () => {
    const [a, b] = await Promise.all([resolveTriviaChannel(), resolveTriviaChannel()]);
    expect([a, b]).toEqual(["c1", "c1"]);
    expect(await resolveTriviaChannel()).toBe("c1");
    expect(resolveConfiguredChannelDetailed).toHaveBeenCalledTimes(1);
    expect(pinChannelId).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await resolveTriviaChannel();
    expect(resolveConfiguredChannelDetailed).toHaveBeenCalledTimes(2);
  });

  it("a failed lookup is not cached", async () => {
    vi.mocked(resolveConfiguredChannelDetailed).mockRejectedValueOnce(new Error("discord down"));
    await expect(resolveTriviaChannel()).rejects.toThrow("discord down");
    expect(await resolveTriviaChannel()).toBe("c1");
  });
});
