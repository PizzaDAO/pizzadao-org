// @vitest-environment node
// /disavow answers a real 404 (via rewrite to a non-existent path) before rendering for
// flag-off, logged-out and ineligible viewers; only eligible viewers pass through.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

vi.mock("@/app/lib/session", () => ({ COOKIE_NAME: "pizzadao_session", verifySession: vi.fn() }));
vi.mock("@/app/lib/disavow/access", () => ({ disavowViewer: vi.fn(), findSubjectDisavowals: vi.fn() }));

import { proxy, config } from "./proxy";
import { verifySession } from "@/app/lib/session";
import { disavowViewer, findSubjectDisavowals } from "@/app/lib/disavow/access";

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;
const req = (path = "/disavow", cookie = "tok") =>
    new NextRequest(`https://app.pizzadao.org${path}`, { headers: cookie ? { cookie: `pizzadao_session=${cookie}` } : {} });
const rewritten = (r: Response) => r.headers.get("x-middleware-rewrite");
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISAVOW_ENABLED = "true";
    m(verifySession).mockReturnValue({ discordId: "d1" });
    m(disavowViewer).mockResolvedValue({ allowed: true, isDPR: false });
    m(findSubjectDisavowals).mockResolvedValue([]);
});
afterEach(() => { delete process.env.DISAVOW_ENABLED; });

describe("proxy for /disavow", () => {
    it("covers the page tree only", () => {
        expect(config.matcher).toEqual(["/disavow", "/disavow/:path*"]);
    });
    it("flag off: rewritten to a path that does not exist, and nothing is looked up", async () => {
        delete process.env.DISAVOW_ENABLED;
        const r = await proxy(req());
        expect(rewritten(r)).toMatch(/_not-found-page$/);
        expect(verifySession).not.toHaveBeenCalled();
        expect(disavowViewer).not.toHaveBeenCalled();
    });
    it("logged out (no or bad session cookie): rewritten", async () => {
        m(verifySession).mockReturnValue(null);
        expect(rewritten(await proxy(req("/disavow/new", "")))).toBeTruthy();
        expect(rewritten(await proxy(req("/disavow/abc", "forged")))).toBeTruthy();
    });
    it("ineligible (including a nominated-only check failing closed): rewritten", async () => {
        m(disavowViewer).mockResolvedValue({ allowed: false, isDPR: false });
        expect(rewritten(await proxy(req("/disavow/abc")))).toBeTruthy();
        expect(rewritten(await proxy(req("/disavow/response")))).toBeTruthy();
    });
    it("lookup errors fail closed", async () => {
        m(disavowViewer).mockRejectedValue(new Error("db"));
        expect(rewritten(await proxy(req()))).toBeTruthy();
    });
    it("eligible viewers pass through", async () => {
        expect(passed(await proxy(req()))).toBe(true);
    });
    it("a listed member (not a viewer) reaches the page tree for their response page", async () => {
        m(disavowViewer).mockResolvedValue({ allowed: false, isDPR: false });
        m(findSubjectDisavowals).mockResolvedValue([{ id: "e1" }]);
        expect(passed(await proxy(req("/disavow/response")))).toBe(true);
    });
});

describe("no title or text leaks from the layout", () => {
    it("the /disavow layout sets no title and calls notFound() before rendering", () => {
        const src = readFileSync(new URL("./app/disavow/layout.tsx", import.meta.url), "utf8");
        expect(src).not.toMatch(/title\s*:/);
        expect(src).toMatch(/if \(!eligible\) notFound\(\)/);
    });
    it("there is no loading.tsx under app/disavow", async () => {
        const { existsSync } = await import("node:fs");
        expect(existsSync(new URL("./app/disavow/loading.tsx", import.meta.url))).toBe(false);
    });
});
