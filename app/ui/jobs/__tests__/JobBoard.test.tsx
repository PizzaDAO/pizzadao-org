import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

vi.mock("@/app/lib/hooks/use-session", () => ({ useSession: () => ({ data: null }) }));
vi.mock("../JobCard", () => ({ JobCard: () => null }));

import { JobBoard } from "../JobBoard";

describe("JobBoard countdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops ticking at zero and backs off instead of refetching every second", async () => {
    // Server keeps returning a reset time that is already in the past.
    const pastReset = new Date(Date.now() - 1_000).toISOString();
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ jobs: [], resetAt: pastReset }), { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    render(<JobBoard />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterMount = f.mock.calls.length;
    // 4s later: no per-second refetch storm (first retry backoff is 5s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(f.mock.calls.length).toBeLessThanOrEqual(afterMount + 1);
    // Backoff grows: far fewer than one request per second over 60s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(56_000);
    });
    expect(f.mock.calls.length).toBeLessThan(10);
  });
});
