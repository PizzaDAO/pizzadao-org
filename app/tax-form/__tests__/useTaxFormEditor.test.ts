import { describe, it, expect, vi, afterEach } from "vitest";
import { seedFormData } from "../_lib/useTaxFormEditor";

afterEach(() => vi.useRealTimers());

describe("seedFormData", () => {
  it("defaults the signature date to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    expect(seedFormData(null).date).toBe("2026-11-13");
    expect(seedFormData({ date: "  " }).date).toBe("2026-11-13");
  });
  it("keeps an existing date", () => {
    expect(seedFormData({ date: "2025-01-02", name: "A" })).toEqual({ date: "2025-01-02", name: "A" });
  });
});
