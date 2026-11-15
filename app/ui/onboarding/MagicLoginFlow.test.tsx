import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { MagicLoginFlow } from "./MagicLoginFlow";

describe("<MagicLoginFlow /> DMs", () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("tells people up front that DMs must be on, with a no-DM alternative", () => {
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        expect(screen.getByText(/direct messages from server members/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Log in with Discord/ })).toHaveAttribute("href", "/api/discord/login");
    });

    it("explains how to enable DMs on desktop and mobile and offers Discord login when the DM fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ status: "dm_failed" }) })));
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        fireEvent.change(screen.getByLabelText("Discord username"), { target: { value: "someone" } });
        fireEvent.click(screen.getByRole("button", { name: /Send login link/ }));
        await waitFor(() => expect(screen.getByText("On a computer")).toBeInTheDocument());
        expect(screen.getByText("On your phone (Discord app)")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Log in with Discord" })).toHaveAttribute("href", "/api/discord/login");
    });
});

describe("<MagicLoginFlow /> after the link is sent", () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        window.history.replaceState(null, "", "/");
    });

    // status: what /api/auth/magic-login/status answers on each poll (the first answer is the mount check).
    function stubApi(statuses: Array<{ loggedIn: boolean; openedElsewhere: boolean }>, me: Record<string, unknown> = {}) {
        const queue = [...statuses];
        const fetchMock = vi.fn(async (url: string) => {
            if (url === "/api/auth/magic-login/request") return { ok: true, json: async () => ({ status: "sent" }) };
            if (url === "/api/auth/magic-login/status") {
                const next = queue.length > 1 ? queue.shift()! : queue[0];
                return { ok: true, json: async () => next };
            }
            if (url === "/api/me") return { ok: true, json: async () => ({ authenticated: true, ...me }) };
            return { ok: false, json: async () => ({}) };
        });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    async function send() {
        fireEvent.change(screen.getByLabelText("Discord username"), { target: { value: "someone" } });
        fireEvent.click(screen.getByRole("button", { name: /Send login link/ }));
        await waitFor(() => expect(screen.getByText("Check your DMs.")).toBeInTheDocument());
    }

    it("moves on to the page the login started from once this browser is logged in", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        window.history.replaceState(null, "", "/login?returnTo=%2Fcalls%2Flive");
        const off = { loggedIn: false, openedElsewhere: false };
        stubApi([off, off, { loggedIn: true, openedElsewhere: false }], { discordId: "1", memberId: "42" });
        const navigate = vi.fn();
        renderWithIntl(<MagicLoginFlow onBack={() => {}} navigate={navigate} />);
        await send();
        expect(screen.getByText(/Open the link in this browser/)).toBeInTheDocument();
        await vi.advanceTimersByTimeAsync(3100);
        expect(navigate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3100);
        await waitFor(() => expect(navigate).toHaveBeenCalledWith("/calls/live"));
    });

    it("says the link was opened in another browser instead of waiting forever", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const off = { loggedIn: false, openedElsewhere: false };
        stubApi([off, { loggedIn: false, openedElsewhere: true }]);
        const navigate = vi.fn();
        renderWithIntl(<MagicLoginFlow onBack={() => {}} navigate={navigate} />);
        await send();
        await vi.advanceTimersByTimeAsync(3100);
        await waitFor(() => expect(screen.getByText("Opened somewhere else.")).toBeInTheDocument());
        expect(screen.getByRole("link", { name: "Log in with Discord" })).toHaveAttribute("href", "/api/discord/login");
        expect(screen.getByRole("button", { name: "Send a new link" })).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });

    it("skips the form when this browser is already logged in", async () => {
        window.history.replaceState(null, "", "/login?returnTo=%2Fcalls%2Flive");
        stubApi([{ loggedIn: true, openedElsewhere: false }], { discordId: "1", memberId: "42" });
        const navigate = vi.fn();
        renderWithIntl(<MagicLoginFlow onBack={() => {}} navigate={navigate} />);
        await waitFor(() => expect(navigate).toHaveBeenCalledWith("/calls/live"));
    });
});
