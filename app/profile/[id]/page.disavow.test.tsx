// @vitest-environment node
// The profile page hands the private warning to the client only for eligible viewers,
// and does not even read the session while the feature flag is off.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/api/profile-summary/[id]/route", () => ({ composeProfileSummary: vi.fn() }));
vi.mock("./ProfileClient", () => ({ ProfileClient: () => null }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/lib/disavow/access", () => ({ canViewDisavowList: vi.fn() }));
vi.mock("@/app/lib/disavow/match", () => ({ findActiveListingFor: vi.fn() }));

import ProfilePage from "./page";
import { getSession } from "@/app/lib/session";
import { canViewDisavowList } from "@/app/lib/disavow/access";
import { findActiveListingFor } from "@/app/lib/disavow/match";

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;
const render = async () => (await ProfilePage({ params: Promise.resolve({ id: "7" }) })) as { props: { disavowWarning: unknown } };

beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISAVOW_ENABLED = "true";
    m(getSession).mockResolvedValue({ discordId: "d1" });
    m(canViewDisavowList).mockResolvedValue(true);
    m(findActiveListingFor).mockResolvedValue({ id: "e1" });
});
afterEach(() => { delete process.env.DISAVOW_ENABLED; });

describe("profile disavow chip", () => {
    it("eligible viewer + listed member gets the warning", async () => {
        expect((await render()).props.disavowWarning).toEqual({ id: "e1" });
    });
    it("non-eligible viewer gets nothing and the listing is never looked up", async () => {
        m(canViewDisavowList).mockResolvedValue(false);
        expect((await render()).props.disavowWarning).toBeNull();
        expect(findActiveListingFor).not.toHaveBeenCalled();
    });
    it("logged out gets nothing", async () => {
        m(getSession).mockResolvedValue(null);
        expect((await render()).props.disavowWarning).toBeNull();
    });
    it("flag off: nothing, and the session is not read", async () => {
        delete process.env.DISAVOW_ENABLED;
        expect((await render()).props.disavowWarning).toBeNull();
        expect(getSession).not.toHaveBeenCalled();
    });
    it("a lookup error shows nothing", async () => {
        m(findActiveListingFor).mockRejectedValue(new Error("db"));
        expect((await render()).props.disavowWarning).toBeNull();
    });
});
