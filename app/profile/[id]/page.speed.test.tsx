// @vitest-environment node
// The profile page paints within its budget: the full summary when it is in time, otherwise the
// light data generateMetadata already loaded (partial). Buddy recognition streams on its own, and the
// passport is only prefilled for a request without a session cookie.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { timedOut: false, hasCookie: false };
const afterFn = vi.fn();
vi.mock("next/server", () => ({ after: (f: unknown) => afterFn(f) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => state.hasCookie }) }));
vi.mock("@/app/api/profile-summary/[id]/route", () => ({
    composeProfileSummary: vi.fn(async () => ({ hero: { name: "Light" }, crewIds: [], about: {} })),
    getPublicProfileSummary: vi.fn(async () => ({ hero: { name: "Full" } })),
    withDeadline: async (p: Promise<unknown>) => (state.timedOut ? { value: null, timedOut: true } : { value: await p, timedOut: false }),
}));
vi.mock("./profile-page-data", () => ({
    PROFILE_PAGE_BUDGET_MS: 1200,
    loadProfilePrefill: vi.fn(async () => ({ articles: null, vouches: null, vouchers: null, attendance: null, passport: null })),
    partialSummaryFromLight: vi.fn((l: { hero: { name: string } }) => ({ hero: { name: l.hero.name }, partial: true })),
}));
vi.mock("./ProfileClient", () => ({ ProfileClient: () => null }));
vi.mock("@/app/lib/db");
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn(), COOKIE_NAME: "pizzadao_session" }));
vi.mock("@/app/lib/disavow/constants", () => ({ disavowEnabled: vi.fn(async () => false) }));
vi.mock("@/app/lib/buddy/recognition", () => ({ getBuddyRecognition: vi.fn(async () => null) }));

import ProfilePage from "./page";
import { composeProfileSummary, getPublicProfileSummary } from "@/app/api/profile-summary/[id]/route";
import { loadProfilePrefill } from "./profile-page-data";
import { getBuddyRecognition } from "@/app/lib/buddy/recognition";

type Props = { initialSummary: { hero: { name: string }; partial?: boolean } | null; buddySlot: unknown };
const render = async () => ((await ProfilePage({ params: Promise.resolve({ id: "7" }) })) as unknown as { props: Props }).props;

beforeEach(() => {
    vi.clearAllMocks();
    state.timedOut = false;
    state.hasCookie = false;
});

describe("profile page first paint", () => {
    it("uses the full summary when it is in time", async () => {
        const p = await render();
        expect(p.initialSummary).toEqual({ hero: { name: "Full" } });
        expect(afterFn).not.toHaveBeenCalled();
    });

    it("past the budget paints the light hero as a partial summary and lets the full compose finish", async () => {
        state.timedOut = true;
        const p = await render();
        expect(p.initialSummary).toEqual({ hero: { name: "Light" }, partial: true });
        expect(composeProfileSummary).toHaveBeenCalledWith({ memberId: "7", viewerMemberId: null, light: true });
        expect(afterFn).toHaveBeenCalledTimes(1);
    });

    it("renders no summary for a missing member (the client shows not found)", async () => {
        vi.mocked(getPublicProfileSummary).mockResolvedValueOnce(null);
        vi.mocked(composeProfileSummary).mockResolvedValueOnce(null);
        expect((await render()).initialSummary).toBeNull();
    });

    it("does not wait on buddy recognition: it is a streamed slot", async () => {
        const p = await render();
        expect(p.buddySlot).toBeTruthy();
        expect(getBuddyRecognition).not.toHaveBeenCalled();
    });

    it("prefills the passport only for a request without a session cookie", async () => {
        await render();
        expect(loadProfilePrefill).toHaveBeenLastCalledWith("7", { anonymous: true });
        state.hasCookie = true;
        await render();
        expect(loadProfilePrefill).toHaveBeenLastCalledWith("7", { anonymous: false });
    });
});
