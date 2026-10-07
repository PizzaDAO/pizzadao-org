// app/ui/XConnectNotice.test.ts
//
// Unit coverage for the x_error / x_connected -> user message mapping used
// by <XConnectNotice/>. Kept as a pure-function test (no component mount /
// ToastProvider needed) per the fix for "X OAuth errors/success are never
// shown to the user".

import { describe, it, expect } from "vitest";
import { xConnectMessage } from "./XConnectNotice";

describe("xConnectMessage", () => {
  it("returns null when neither param is present", () => {
    expect(xConnectMessage({})).toBeNull();
    expect(xConnectMessage({ xError: null, xConnected: null })).toBeNull();
  });

  it("maps x_connected to a success message", () => {
    expect(xConnectMessage({ xConnected: "1" })).toEqual({
      kind: "success",
      text: "X account connected!",
    });
  });

  it("prefers x_connected over x_error if somehow both are present", () => {
    expect(xConnectMessage({ xConnected: "1", xError: "cancelled" })).toEqual({
      kind: "success",
      text: "X account connected!",
    });
  });

  it("maps cancelled to a cancellation message", () => {
    expect(xConnectMessage({ xError: "cancelled" })).toEqual({
      kind: "error",
      text: "X connection cancelled.",
    });
  });

  it.each(["invalid_state", "missing_verifier"])(
    "maps %s to the session-expired message",
    (code) => {
      const result = xConnectMessage({ xError: code });
      expect(result?.kind).toBe("error");
      expect(result?.text).toMatch(/session expired|different browser/i);
    }
  );

  it.each(["failed", "no_code", "some_unknown_future_code"])(
    "maps %s (and any unrecognized code) to a generic failure message",
    (code) => {
      expect(xConnectMessage({ xError: code })).toEqual({
        kind: "error",
        text: "Couldn't connect your X account. Please try again.",
      });
    }
  );
});
