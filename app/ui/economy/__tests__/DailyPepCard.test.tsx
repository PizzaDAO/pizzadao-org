import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { DailyPepCard, formatWait } from "../DailyPepCard";

function stubFetch(handlers: Array<{ status: number; body: unknown }>) {
  const queue = [...handlers];
  const fn = vi.fn(async () => {
    const h = queue.length > 1 ? queue.shift()! : queue[0];
    return new Response(JSON.stringify(h.body), { status: h.status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const roles = [{ name: "Box Mafia", amount: 42 }];

describe("DailyPepCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the amount, collects, and updates the balance in place", async () => {
    stubFetch([
      { status: 200, body: { totalAvailable: 42, nextReadyAt: null, earnRoles: roles } },
      { status: 200, body: { total: 42, balance: 1042, paid: [], nextReadyAt: new Date(Date.now() + 86_400_000).toISOString() } },
    ]);
    const onCollected = vi.fn();
    renderWithIntl(<DailyPepCard onCollected={onCollected} />);
    expect(await screen.findByText("42 PEP ready to collect")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collect" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Collected 42 PEP"));
    expect(onCollected).toHaveBeenCalledWith(1042);
    expect(screen.getByTestId("daily-pep-wait").textContent).toMatch(/Next collect in 23h|Next collect in 24h/);
    expect(screen.getByText("Also works in Discord: /collect-income")).toBeTruthy();
  });

  it("shows a countdown while waiting", async () => {
    stubFetch([{ status: 200, body: { totalAvailable: 0, nextReadyAt: new Date(Date.now() + 3 * 3_600_000 + 5 * 60_000).toISOString(), earnRoles: roles } }]);
    renderWithIntl(<DailyPepCard />);
    expect((await screen.findByTestId("daily-pep-wait")).textContent).toMatch(/Next collect in 3h [45]m/);
    expect(screen.queryByRole("button", { name: "Collect" })).toBeNull();
  });

  it("names the role to get when nothing is collectible", async () => {
    stubFetch([{ status: 200, body: { totalAvailable: 0, nextReadyAt: null, earnRoles: roles } }]);
    renderWithIntl(<DailyPepCard />);
    expect((await screen.findByTestId("daily-pep-noroles")).textContent).toContain("Get the Box Mafia role to earn 42 PEP a day.");
  });

  it("says 'every N hours' for non-daily roles", async () => {
    stubFetch([{ status: 200, body: { totalAvailable: 0, nextReadyAt: null, earnRoles: [{ name: "OG", amount: 5, intervalHours: 12 }] } }]);
    renderWithIntl(<DailyPepCard />);
    expect((await screen.findByTestId("daily-pep-noroles")).textContent).toContain("5 PEP every 12 hours");
  });

  it("retries every 15s while the countdown is over but the server says not ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fn = stubFetch([{ status: 200, body: { totalAvailable: 0, nextReadyAt: new Date(Date.now() - 1000).toISOString(), earnRoles: roles } }]);
      renderWithIntl(<DailyPepCard />);
      await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2));
      const before = fn.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15_100);
      expect(fn.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders in Spanish", async () => {
    stubFetch([{ status: 200, body: { totalAvailable: 42, nextReadyAt: null, earnRoles: roles } }]);
    renderWithIntl(<DailyPepCard />, { locale: "es" });
    expect(await screen.findByRole("button", { name: "Cobrar" })).toBeTruthy();
  });

  it("formats waits", () => {
    expect(formatWait(3 * 3600 + 125)).toMatchObject({ key: "timeHM", h: 3, m: 2 });
    expect(formatWait(600)).toMatchObject({ key: "timeM", m: 10 });
    expect(formatWait(10).key).toBe("timeS");
  });
});
