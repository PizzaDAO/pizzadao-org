// @vitest-environment jsdom
// Server-prefilled sections render from props and make no request on mount; without a prefill they
// fetch as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { AttendanceCard } from "../attendance-card";
import { PassportBlock } from "./PassportBlock";
import { VouchesWidget } from "../vouches/VouchesWidget";
import { VouchedBy } from "../vouches/VouchedBy";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ totalCalls: 0, crewBreakdown: {}, recentCalls: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("prefilled profile sections", () => {
  it("attendance renders from the prefill without fetching", () => {
    const { container } = render(
      <AttendanceCard memberId="7" variant="inline" initialData={{ totalCalls: 12, crewBreakdown: {}, recentCalls: [] } as never} />,
    );
    expect(container.textContent).toContain("12");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attendance fetches when nothing was prefilled", async () => {
    render(<AttendanceCard memberId="7" variant="inline" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/attendance/7"));
  });

  it("passport renders the prefilled anonymous view without fetching, and fetches when not prefilled", async () => {
    const stamp = { slug: "s", name: "Rome", city: "Rome", countryCode: "IT", ink: "#000", logoUrl: null, verified: true, pinned: false, month: "2026-01" };
    const { container } = render(<PassportBlock memberId="7" initialData={{ enabled: true, stamps: [stamp] } as never} />);
    expect(container.textContent).toContain("Rome");
    expect(fetchMock).not.toHaveBeenCalled();
    render(<PassportBlock memberId="7" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/passport/7");
  });

  it("vouches and vouchers render from the prefill without fetching", () => {
    const a = render(<VouchesWidget memberId="7" initialData={{ vouches: [{ memberId: "9", name: "Ann", city: "Oslo" }], counts: { total: 1 } }} />);
    expect(a.container.textContent).toContain("Ann");
    const b = render(<VouchedBy memberId="7" initialData={{ enabled: true, total: 1, vouchers: [{ memberId: "8", name: "Bo", city: "Rio" }] }} />);
    expect(b.container.textContent).toContain("Bo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vouchers prefilled as disabled render nothing and do not fetch", () => {
    const { container } = render(<VouchedBy memberId="7" initialData={{ enabled: false }} />);
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
