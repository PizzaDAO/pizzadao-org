import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: null as null | { discordId: string } }));
const scope = vi.hoisted(() => ({ value: null as null | ((l: number) => boolean) }));
const aggregate = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/session", () => ({ getSession: async () => session.value }));
vi.mock("@/app/lib/db", () => ({ prisma: { missionCompletion: { aggregate } } }));
vi.mock("@/app/lib/mission-review-access", () => ({ missionReviewScope: async () => scope.value }));
vi.mock("@/app/lib/settings", () => ({ getSetting: async () => 15 }));

import { GET } from "./route";

const call = (qs = "") => GET(new Request(`http://x/api/missions/version${qs}`) as never);

beforeEach(() => {
  aggregate.mockReset();
  aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { updatedAt: new Date(5000) } });
  session.value = { discordId: "u1" };
  scope.value = null;
});

describe("GET /api/missions/version", () => {
  it("rejects signed-out viewers", async () => {
    session.value = null;
    expect((await call()).status).toBe(401);
  });

  it("gives a non-reviewer no queue data, even when asked", async () => {
    const res = await call("?queue=1");
    expect(await res.json()).toEqual({ mine: "2:5000", queue: null, intervalSeconds: 15 });
    expect(aggregate).toHaveBeenCalledTimes(1); // only their own rows
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("gives a reviewer the queue marker only when asked", async () => {
    scope.value = (l) => l <= 7;
    expect((await (await call()).json()).queue).toBeNull();
    aggregate.mockClear();
    const body = await (await call("?queue=1")).json();
    expect(body.queue).toBe("2:5000");
    expect(aggregate).toHaveBeenCalledTimes(2);
    const where = aggregate.mock.calls[1][0].where;
    expect(where.status).toBe("PENDING");
    expect(where.discordId).toEqual({ not: "u1" });
    expect(where.mission.level.in).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
