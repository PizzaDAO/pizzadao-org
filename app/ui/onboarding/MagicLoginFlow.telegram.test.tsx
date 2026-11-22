import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { MagicLoginFlow } from "./MagicLoginFlow";

type Reply = { ok: boolean; json: () => Promise<unknown> };

function stubApi(opts: { enabled: boolean; statuses?: unknown[] }) {
    const statuses = [...(opts.statuses ?? [])];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Reply> => {
        const method = init?.method ?? "GET";
        if (url.startsWith("/api/auth/telegram/start") && method === "GET") return { ok: true, json: async () => ({ enabled: opts.enabled }) };
        if (url === "/api/auth/telegram/start" && method === "POST") {
            return { ok: true, json: async () => ({ url: "https://t.me/pizzadao_login_bot?start=si_abc", matchNumber: 47, expiresInSeconds: 300 }) };
        }
        if (url === "/api/auth/telegram/start" && method === "DELETE") return { ok: true, json: async () => ({ ok: true }) };
        if (url === "/api/auth/telegram/status") {
            const next = statuses.length > 1 ? statuses.shift() : statuses[0];
            return { ok: true, json: async () => next ?? { status: "pending" } };
        }
        if (url === "/api/auth/magic-login/status") return { ok: true, json: async () => ({ loggedIn: false, openedElsewhere: false }) };
        return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("<MagicLoginFlow /> sign in with Telegram", () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        window.history.replaceState(null, "", "/");
    });

    it("hides the button while the feature is off", async () => {
        const fetchMock = stubApi({ enabled: false });
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/auth/telegram/start"), expect.anything()));
        expect(screen.queryByRole("button", { name: "Sign in with Telegram" })).toBeNull();
    });

    it("asks for the forced view when the page was opened with ?telegram=1", async () => {
        window.history.replaceState(null, "", "/login?telegram=1");
        const fetchMock = stubApi({ enabled: true });
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        await screen.findByRole("button", { name: "Sign in with Telegram" });
        expect(fetchMock).toHaveBeenCalledWith("/api/auth/telegram/start?forced=1", expect.anything());
    });

    it("shows the number and the Telegram link, then navigates once the poll says approved", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        window.history.replaceState(null, "", "/login?returnTo=%2Fcalls%2Flive");
        const fetchMock = stubApi({ enabled: true, statuses: [{ status: "pending" }, { status: "approved", href: "/calls/live" }] });
        const navigate = vi.fn();
        renderWithIntl(<MagicLoginFlow onBack={() => {}} navigate={navigate} />);
        fireEvent.click(await screen.findByRole("button", { name: "Sign in with Telegram" }));
        expect(await screen.findByText("47")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open Telegram/ })).toHaveAttribute("href", "https://t.me/pizzadao_login_bot?start=si_abc");
        const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
        expect(JSON.parse(String(post[1]?.body))).toEqual({ returnTo: "/calls/live" });
        expect(navigate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3100);
        await vi.advanceTimersByTimeAsync(3100);
        await waitFor(() => expect(navigate).toHaveBeenCalledWith("/calls/live"));
    });

    it("says so when the tap was the wrong number, and offers to start again", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        stubApi({ enabled: true, statuses: [{ status: "cancelled" }] });
        const navigate = vi.fn();
        renderWithIntl(<MagicLoginFlow onBack={() => {}} navigate={navigate} />);
        fireEvent.click(await screen.findByRole("button", { name: "Sign in with Telegram" }));
        await screen.findByText("47");
        await vi.advanceTimersByTimeAsync(3100);
        expect(await screen.findByText(/sign-in was cancelled/)).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Start again" }));
        expect(await screen.findByRole("button", { name: "Sign in with Telegram" })).toBeInTheDocument();
    });

    it("Stop waiting discards the request on the server and returns to the form", async () => {
        const fetchMock = stubApi({ enabled: true });
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        fireEvent.click(await screen.findByRole("button", { name: "Sign in with Telegram" }));
        await screen.findByText("47");
        fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
        await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true));
        expect(await screen.findByRole("button", { name: "Sign in with Telegram" })).toBeInTheDocument();
    });
});
