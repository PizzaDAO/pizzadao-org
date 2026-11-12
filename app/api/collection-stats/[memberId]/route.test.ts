// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const afterMock = vi.fn();
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (...a: unknown[]) => afterMock(...a) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberById: vi.fn() }));
vi.mock("@/app/lib/collection-stats", () => ({
  readCollectionStats: vi.fn(),
  refreshCollectionStats: vi.fn(),
  collectionStatsFreshHours: vi.fn(async () => 26),
  isStale: vi.fn(() => true),
  isRefreshing: vi.fn(() => false),
}));

import { GET } from "./route";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { readCollectionStats } from "@/app/lib/collection-stats";

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;
const call = (id: string) => GET(new Request("http://x") as never, { params: Promise.resolve({ memberId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m(readCollectionStats).mockResolvedValue(null);
});

describe("collection-stats route", () => {
  it("404s an unknown member without reading the table or scheduling a refresh", async () => {
    m(fetchMemberById).mockResolvedValue(null);
    const res = await call("999");
    expect(res.status).toBe(404);
    expect(readCollectionStats).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("503 no-store when the member lookup throws (not a cached 404)", async () => {
    m(fetchMemberById).mockRejectedValue(new Error("sheet down"));
    const res = await call("1");
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("400s a malformed id", async () => {
    const res = await call("a/../b%00");
    expect(res.status).toBe(400);
    expect(fetchMemberById).not.toHaveBeenCalled();
  });

  it("serves pending and schedules one refresh for a known member with no row", async () => {
    m(fetchMemberById).mockResolvedValue({ id: "1" });
    const res = await call("1");
    expect(res.status).toBe(200);
    expect((await res.json()).pending).toBe(true);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
