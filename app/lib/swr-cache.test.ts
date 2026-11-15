import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

import { swrGet } from "./swr-cache";
import { cacheDel, cacheSet } from "@/app/api/lib/cache";

const opts = { freshSeconds: 60, keepSeconds: 600 };
const tasks: Array<() => Promise<void>> = [];
const schedule = (t: () => Promise<void>) => void tasks.push(t);
const flush = async () => { await Promise.all(tasks.splice(0).map((t) => t())); };

beforeEach(async () => {
  tasks.length = 0;
  await cacheDel("k");
  await cacheDel("k:refresh-lock");
});

describe("swrGet", () => {
  it("blocks on the loader when nothing is cached, then serves from cache", async () => {
    const load = vi.fn().mockResolvedValue("a");
    expect(await swrGet("k", load, { ...opts, schedule })).toEqual({ value: "a", cached: false });
    expect(await swrGet("k", load, { ...opts, schedule })).toEqual({ value: "a", cached: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(0);
  });

  it("serves a stale value immediately and refreshes in the background", async () => {
    await cacheSet("k", { value: "old", fetchedAt: Date.now() - 120_000 }, 600);
    const load = vi.fn().mockResolvedValue("new");
    expect(await swrGet("k", load, { ...opts, schedule })).toEqual({ value: "old", cached: true });
    expect(load).not.toHaveBeenCalled();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect((await swrGet("k", load, { ...opts, schedule })).value).toBe("new");
  });

  it("single-flights concurrent stale reads", async () => {
    await cacheSet("k", { value: "old", fetchedAt: 0 }, 600);
    let release!: () => void;
    const load = vi.fn(() => new Promise<string>((r) => { release = () => r("new"); }));
    await swrGet("k", load, { ...opts, schedule });
    await swrGet("k", load, { ...opts, schedule });
    const running = flush();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await running;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the stale value when the refresh fails and releases the lock", async () => {
    await cacheSet("k", { value: "old", fetchedAt: 0 }, 600);
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("new");
    await swrGet("k", load, { ...opts, schedule });
    await flush();
    expect((await swrGet("k", load, { ...opts, schedule })).value).toBe("old");
    await flush();
    expect((await swrGet("k", load, { ...opts, schedule })).value).toBe("new");
  });

  it("treats an entry without a timestamp as stale", async () => {
    await cacheSet("k", { crews: [1] }, 600);
    const load = vi.fn().mockResolvedValue({ crews: [2] });
    expect((await swrGet("k", load, { ...opts, schedule })).value).toEqual({ crews: [1] });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh blocks on the loader", async () => {
    await cacheSet("k", { value: "old", fetchedAt: Date.now() }, 600);
    const load = vi.fn().mockResolvedValue("fresh");
    expect(await swrGet("k", load, { ...opts, forceRefresh: true, schedule })).toEqual({ value: "fresh", cached: false });
  });
});
