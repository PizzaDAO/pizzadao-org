// The verified X card: a successful load never flashes the load-failure
// alert (including with cached data on first render), and the Connect button
// only exists when X sign-in is configured.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const hooks = vi.hoisted(() => ({
    x: { data: undefined as unknown, isLoading: false, isFetching: false, refetch: () => {} },
}));

vi.mock("../../../lib/hooks/use-api", () => ({
    useUserData: () => ({ data: { Orgs: "", Skills: "", Tagline: "" }, isLoading: false, error: null }),
    useXAccount: () => hooks.x,
}));
vi.mock("../../../ui/profile-links", () => ({ ProfileLinksEditor: () => null }));
vi.mock("../../../ui/vouches/SocialAccountLinker", () => ({ SocialAccountLinker: () => null }));
vi.mock("../../../ui/telegram/TelegramLinker", () => ({ TelegramLinker: () => null }));
vi.mock("../../../dashboard/[id]/components/TaglineEditor", () => ({ TaglineEditor: () => null }));
vi.mock("../../../ui/profile/LanguageEditor", () => ({ LanguageEditor: () => null }));
vi.mock("./EmailPrefsEditor", () => ({ EmailPrefsEditor: () => null }));

import { EditClient } from "./EditClient";

beforeEach(() => {
    hooks.x = { data: undefined, isLoading: false, isFetching: false, refetch: () => {} };
});

describe("EditClient X card", () => {
    it("never shows the load-failure alert when cached data is present on first render", () => {
        hooks.x = { ...hooks.x, data: { connected: true, username: "someone" } };
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        expect(screen.queryByText("Couldn't load your X account.")).toBeNull();
        expect(screen.getByText("@someone")).toBeTruthy();
    });

    it("shows the failure alert only when the load really failed", () => {
        hooks.x = { ...hooks.x, data: null };
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        expect(screen.getByText("Couldn't load your X account.")).toBeTruthy();
    });

    it("hides the Connect button when X sign-in is not configured", () => {
        hooks.x = { ...hooks.x, data: { connected: false } };
        renderWithIntl(<EditClient memberId="1" xConfigured={false} />);
        expect(screen.queryByText("Connect X")).toBeNull();
        expect(screen.getByText("Connecting X isn't available right now.")).toBeTruthy();
    });

    it("shows Connect when configured", () => {
        hooks.x = { ...hooks.x, data: { connected: false } };
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        expect(screen.getByText("Connect X")).toBeTruthy();
    });

    it("keeps the disconnected override even while query data still says connected", async () => {
        hooks.x = { ...hooks.x, data: { connected: true, username: "someone" } };
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(screen.getByText("Connect X")).toBeTruthy());
        expect(screen.queryByText("@someone")).toBeNull();
    });
});
