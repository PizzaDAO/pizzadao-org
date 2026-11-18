import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSession, LOGGED_OUT_SESSION } from "./use-session";

let cookie = "";
const fetchMock = vi.fn();

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  cookie = "";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", {
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      // Mimic the browser: keep only name=value.
      cookie = v.split(";")[0];
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchSession hint logic", () => {
  it("hint 0: skips /api/session and uses /api/session/public", async () => {
    cookie = "pizzadao_auth=0";
    fetchMock.mockResolvedValueOnce(json(200, { authenticated: false, showProposals: true }));
    const s = await fetchSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/session/public");
    expect(s).toEqual({ ...LOGGED_OUT_SESSION, showProposals: true });
  });

  it("hint 0 but the public call fails: falls back to the real check", async () => {
    cookie = "pizzadao_auth=0";
    fetchMock.mockRejectedValueOnce(new Error("net"));
    fetchMock.mockResolvedValueOnce(json(401, { authenticated: false }));
    expect(await fetchSession()).toEqual(LOGGED_OUT_SESSION);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/session/public", "/api/session"]);
  });

  it("missing hint: does the real check and records the 401 as hint 0", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { authenticated: false }));
    expect(await fetchSession()).toEqual(LOGGED_OUT_SESSION);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/session"]);
    expect(cookie).toBe("pizzadao_auth=0");
  });

  it("stale hint 1 with no session: 401, treated as logged out, hint cleared to 0", async () => {
    cookie = "pizzadao_auth=1";
    fetchMock.mockResolvedValueOnce(json(401, { authenticated: false, showProposals: true }));
    expect(await fetchSession()).toEqual({ ...LOGGED_OUT_SESSION, showProposals: true });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/session"]);
    expect(cookie).toBe("pizzadao_auth=0");
  });

  it("hint 1 with a real session: returns the session data", async () => {
    cookie = "pizzadao_auth=1";
    fetchMock.mockResolvedValueOnce(json(200, { authenticated: true, discordId: "d1" }));
    expect(await fetchSession()).toMatchObject({ authenticated: true, discordId: "d1" });
    expect(cookie).toBe("pizzadao_auth=1");
  });

  it("other errors still throw", async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}));
    await expect(fetchSession()).rejects.toThrow("Session fetch failed");
  });
});
