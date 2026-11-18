import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountdown } from "../CrimeCard";

describe("useCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts down and stops its interval once it reaches zero", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const readyAt = Date.now() + 2_000;
    const { result } = renderHook(() => useCountdown(readyAt));
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(result.current).toBe(0);
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an interval when already past", () => {
    const readyAt = Date.now() - 1_000;
    const { result } = renderHook(() => useCountdown(readyAt));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
