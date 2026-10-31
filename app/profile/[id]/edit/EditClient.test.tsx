// The verified X card: a successful load never flashes the load-failure
// alert (including with cached data on first render), and the Connect button
// only exists when X sign-in is configured.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const hooks = vi.hoisted(() => ({
    x: { data: undefined as unknown, isLoading: false, isFetching: false, refetch: () => {} },
    user: { data: { Orgs: "", Skills: "", Tagline: "" } as unknown, isLoading: false, error: null as unknown },
    hideManualX: [] as unknown[],
}));

vi.mock("../../../lib/hooks/use-api", () => ({
    useUserData: () => hooks.user,
    useXAccount: () => hooks.x,
}));
vi.mock("../../../ui/profile-links", () => ({ ProfileLinksEditor: () => null }));
vi.mock("../../../ui/vouches/SocialAccountLinker", () => ({
    SocialAccountLinker: (props: { hideManualX?: boolean }) => {
        hooks.hideManualX.push(props.hideManualX);
        return null;
    },
}));
vi.mock("../../../ui/telegram/TelegramLinker", () => ({ TelegramLinker: () => null }));
vi.mock("../../../dashboard/[id]/components/TaglineEditor", () => ({ TaglineEditor: () => null }));
vi.mock("../../../ui/profile/LanguageEditor", () => ({ LanguageEditor: () => null }));
vi.mock("./EmailPrefsEditor", () => ({ EmailPrefsEditor: () => null }));

import { EditClient } from "./EditClient";

beforeEach(() => {
    hooks.user = { data: { Orgs: "", Skills: "", Tagline: "" }, isLoading: false, error: null };
    hooks.hideManualX = [];
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

    it("hideManualX follows the disconnect override, and survives the X card unmounting", async () => {
        hooks.x = { ...hooks.x, data: { connected: true, username: "someone" } };
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
        const view = renderWithIntl(<EditClient memberId="1" xConfigured={false} />);
        const last = () => hooks.hideManualX[hooks.hideManualX.length - 1];
        expect(last()).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(last()).toBe(false));

        // Unmount the X card (page flips to loading) and back: still false.
        hooks.user = { data: undefined, isLoading: true, error: null };
        view.rerender(<EditClient memberId="1" xConfigured={false} />);
        hooks.user = { data: { Orgs: "", Skills: "", Tagline: "" }, isLoading: false, error: null };
        view.rerender(<EditClient memberId="1" xConfigured={false} />);
        expect(last()).toBe(false);
    });
});

describe("EditClient load-failure screen", () => {
    const fail = (message: string) => {
        hooks.user = { data: undefined, isLoading: false, error: new Error(message) };
    };

    it.each(["__AUTH_401__", "__AUTH_403__"])("shows the sign-in message for %s, not the raw marker", (m) => {
        fail(m);
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        expect(screen.getByText("Please sign in again.")).toBeTruthy();
        expect(screen.queryByText(m)).toBeNull();
    });

    it("shows the try-again message for other errors, never the raw message", () => {
        fail("Internal secret detail");
        renderWithIntl(<EditClient memberId="1" xConfigured />);
        expect(screen.getByText("Please try again in a moment.")).toBeTruthy();
        expect(screen.queryByText("Internal secret detail")).toBeNull();
    });
});
