// @vitest-environment jsdom
// useProfileSummary: a complete server summary is fresh (no immediate refetch of /api/profile-summary);
// a partial one (painted from the light data) refetches at once to fill in the slow fields.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProfileSummary, type ProfileSummaryData } from "./use-api";

const base: ProfileSummaryData = {
  hero: { name: "Pat", pfpUrl: null, tagline: "", city: "Rome", level: 3, levelTitle: "X", mafiaRank: null, vouchInCount: 0 },
  about: { skills: "", orgs: "", turtles: [], xAccount: null },
  crewIds: [],
  crewOptions: [],
  viewerId: null,
  isOwner: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...base, hero: { ...base.hero, level: 5 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("useProfileSummary", () => {
  it("does not refetch when the server summary is complete", async () => {
    const { result } = renderHook(() => useProfileSummary("7", base), { wrapper });
    expect(result.current.data).toEqual(base);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches at once when the server summary is partial", async () => {
    const { result } = renderHook(() => useProfileSummary("7", { ...base, partial: true }), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data?.hero.level).toBe(5));
  });

  it("fetches normally when there is no server summary", async () => {
    renderHook(() => useProfileSummary("7", null), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
