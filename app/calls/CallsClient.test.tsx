import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import CallsClient, { type CallsResponse } from "./CallsClient";

vi.mock("@/app/ui/calls/LiveCallBanner", () => ({ default: () => null }));

const initial: CallsResponse = {
  calls: [{ date: "2026-11-01", crewId: "ops", crewLabel: "Ops", attendeeCount: 3 }],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  filters: { crews: [{ id: "ops", label: "Ops", count: 1 }] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<CallsClient /> with server data", () => {
  it("skips the first fetch, then fetches again when returning to the default view", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => initial }) as Response);
    vi.stubGlobal("fetch", f);
    renderWithIntl(<CallsClient initialData={initial} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();

    const chip = await screen.findByText("Ops (1)");
    fireEvent.click(chip);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("crew=ops");

    fireEvent.click(screen.getByText("Ops (1)"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(String((f.mock.calls[1] as unknown[])[0])).not.toContain("crew=");
  });
});
