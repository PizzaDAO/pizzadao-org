// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = {
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  stopSessionRecording: vi.fn(),
  startSessionRecording: vi.fn(),
};

vi.mock("posthog-js", () => ({ default: fake }));
vi.mock("./config", () => ({
  HIGH_INTENT_PATHS: [],
  POSTHOG_DEBUG: false,
  POSTHOG_HOST: "https://example.test",
  POSTHOG_KEY: "phc_test",
  REPLAY_GLOBAL_SAMPLE: 0,
}));

describe("lazy PostHog", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(fake).forEach((f) => f.mockClear());
    (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback = (cb) => {
      cb();
      return 1;
    };
  });

  it("opts back in after loading (clears a stale opt-out) and replays queued events", async () => {
    const mod = await import("./posthog");
    mod.initPostHog();
    mod.track("early_event", { a: 1 }); // before the library has loaded
    await vi.waitFor(() => expect(fake.init).toHaveBeenCalled());
    await vi.waitFor(() => expect(fake.capture).toHaveBeenCalledWith("early_event", { a: 1 }));
    expect(fake.opt_in_capturing).toHaveBeenCalled();
    expect(fake.opt_in_capturing.mock.invocationCallOrder[0]).toBeLessThan(fake.capture.mock.invocationCallOrder[0]);
  });

  it("does not opt in or capture when the visitor left marketing while loading", async () => {
    const mod = await import("./posthog");
    mod.initPostHog();
    mod.track("early_event");
    mod.setActive(false);
    await vi.waitFor(() => expect(fake.init).toHaveBeenCalled());
    await vi.waitFor(() => expect(fake.opt_out_capturing).toHaveBeenCalled());
    expect(fake.opt_in_capturing).not.toHaveBeenCalled();
    expect(fake.capture).not.toHaveBeenCalled();
  });
});
