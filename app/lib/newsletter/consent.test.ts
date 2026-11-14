import { describe, expect, it } from "vitest";
import {
  canConfirm,
  CONFIRM_DAILY_CAP,
  CONFIRM_MIN_GAP_MS,
  confirmThrottle,
  isLegacyUnconfirmed,
  isMailable,
  sendsToday,
  signupAction,
} from "./consent";

const NOW = 1_800_000_000_000;
const row = (o: Partial<Parameters<typeof signupAction>[0] & object> = {}) => ({
  status: "pending",
  confirmedAt: null as Date | null,
  confirmSentAt: null as Date | null,
  confirmSends: 0,
  ...o,
});

describe("consent state machine", () => {
  it("only a subscribed row with confirmedAt is mailable", () => {
    expect(isMailable(row({ status: "subscribed", confirmedAt: new Date(NOW) }))).toBe(true);
    expect(isMailable(row({ status: "subscribed" }))).toBe(false); // legacy
    expect(isMailable(row({ status: "pending", confirmedAt: new Date(NOW) }))).toBe(false);
    expect(isMailable(row({ status: "unsubscribed", confirmedAt: new Date(NOW) }))).toBe(false);
    expect(isLegacyUnconfirmed(row({ status: "subscribed" }))).toBe(true);
    expect(isLegacyUnconfirmed(row())).toBe(false);
  });

  it("signup: new -> create, confirmed -> none, everything else -> reconfirm", () => {
    expect(signupAction(null)).toBe("create");
    expect(signupAction(row({ status: "subscribed", confirmedAt: new Date(NOW) }))).toBe("none");
    expect(signupAction(row())).toBe("reconfirm");
    expect(signupAction(row({ status: "subscribed" }))).toBe("reconfirm");
    expect(signupAction(row({ status: "unsubscribed", confirmedAt: new Date(NOW - 1000) }))).toBe("reconfirm");
  });

  it("throttle: one per hour, at most the daily cap, counter restarts after a day", () => {
    expect(confirmThrottle(row(), NOW)).toBe("ok");
    expect(confirmThrottle(row({ confirmSentAt: new Date(NOW - CONFIRM_MIN_GAP_MS + 1000), confirmSends: 1 }), NOW)).toBe("too_soon");
    expect(confirmThrottle(row({ confirmSentAt: new Date(NOW - CONFIRM_MIN_GAP_MS - 1000), confirmSends: 1 }), NOW)).toBe("ok");
    expect(confirmThrottle(row({ confirmSentAt: new Date(NOW - CONFIRM_MIN_GAP_MS - 1000), confirmSends: CONFIRM_DAILY_CAP }), NOW)).toBe("too_many");
    const old = row({ confirmSentAt: new Date(NOW - 25 * 3600_000), confirmSends: CONFIRM_DAILY_CAP });
    expect(sendsToday(old, NOW)).toBe(0);
    expect(confirmThrottle(old, NOW)).toBe("ok");
  });

  it("a link issued before an unsubscribe can no longer confirm", () => {
    expect(canConfirm({ unsubscribedAt: null }, NOW)).toBe(true);
    expect(canConfirm({ unsubscribedAt: new Date(NOW - 10) }, NOW)).toBe(true);
    expect(canConfirm({ unsubscribedAt: new Date(NOW + 10) }, NOW)).toBe(false);
  });
});
