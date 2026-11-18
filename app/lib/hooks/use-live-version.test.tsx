import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { nextDelayMs, useLiveVersion } from "./use-live-version";

let vis: "visible" | "hidden" = "visible";
let calls: string[] = [];
let responses: Array<Response | Error> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vis = "visible";
  calls = [];
  responses = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r ?? new Response(JSON.stringify({ mine: "1:1", queue: null, intervalSeconds: 15 }));
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const v = (mine: string, queue: string | null = null, intervalSeconds = 15) =>
  new Response(JSON.stringify({ mine, queue, intervalSeconds }));
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("nextDelayMs", () => {
  it("doubles per error and caps", () => {
    expect(nextDelayMs(15, 0)).toBe(15_000);
    expect(nextDelayMs(15, 1)).toBe(30_000);
    expect(nextDelayMs(15, 10)).toBe(120_000);
  });
});

describe("useLiveVersion", () => {
  it("treats the first reading as a baseline, then fires onChange on a change", async () => {
    responses = [v("1:1"), v("1:1"), v("2:5")];
    const onChange = vi.fn();
    renderHook(() => useLiveVersion({ onChange }));
    await tick(0);
    await tick(15_000);
    expect(onChange).not.toHaveBeenCalled();
    await tick(15_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ mine: true, queue: false });
  });

  it("flags a queue change and asks for the queue marker", async () => {
    responses = [v("1:1", "0:0"), v("1:1", "1:9")];
    const onChange = vi.fn();
    renderHook(() => useLiveVersion({ queue: true, onChange }));
    await tick(0);
    await tick(15_000);
    expect(calls[0]).toBe("/api/missions/version?queue=1");
    expect(onChange.mock.calls[0][0]).toEqual({ mine: false, queue: true });
  });

  it("pauses while hidden and checks immediately when visible again", async () => {
    renderHook(() => useLiveVersion({ onChange: vi.fn() }));
    await tick(0);
    expect(calls).toHaveLength(1);
    vis = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(60_000);
    expect(calls).toHaveLength(1);
    vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(calls).toHaveLength(2);
  });

  it("backs off on errors", async () => {
    responses = [new Error("x"), new Error("x")];
    renderHook(() => useLiveVersion({ onChange: vi.fn() }));
    await tick(0);
    await tick(15_000);
    expect(calls).toHaveLength(1); // next wait is 30s after one error
    await tick(15_000);
    expect(calls).toHaveLength(2);
    await tick(30_000);
    expect(calls).toHaveLength(2); // 60s after two errors
    await tick(30_000);
    expect(calls).toHaveLength(3);
  });

  it("stops on 401 and when the setting is 0", async () => {
    responses = [new Response("{}", { status: 401 })];
    renderHook(() => useLiveVersion({ onChange: vi.fn() }));
    await tick(0);
    await tick(120_000);
    expect(calls).toHaveLength(1);
    cleanup();
    calls = [];
    responses = [v("1:1", null, 0)];
    renderHook(() => useLiveVersion({ onChange: vi.fn() }));
    await tick(0);
    await tick(120_000);
    expect(calls).toHaveLength(1);
  });

  it("does nothing when disabled", async () => {
    renderHook(() => useLiveVersion({ enabled: false, onChange: vi.fn() }));
    await tick(30_000);
    expect(calls).toHaveLength(0);
  });
});
