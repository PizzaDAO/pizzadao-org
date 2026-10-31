// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { CATALOGS, renderWithIntl } from "@/app/lib/i18n/test-utils";
import { TelegramLinker } from "./TelegramLinker";

const M = CATALOGS.en.telegramLink;

type Reply = { status?: number; body?: unknown } | "throw" | (() => Promise<{ status?: number; body?: unknown }>);
let routes: Record<string, Reply>;
let calls: string[];

const account = { enabled: true, botUsername: "login_bot", connected: false, telegramDm: { state: "unknown", botUsername: null } };

function resetRoutes() {
    routes = {
        "GET /api/telegram/account": { body: account },
        "GET /api/telegram/host-match": { body: { enabled: false, state: "none" } },
        "POST /api/telegram/link/start": { body: { url: "https://t.me/login_bot?start=abc" } },
        "GET /api/telegram/link/pending": { body: { pending: null } },
        "POST /api/telegram/link/pending": { body: { ok: true } },
    };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(3000); });

const prompt = { body: { pending: { username: "someone", name: null } } };
const connected = {
    enabled: true,
    botUsername: "login_bot",
    connected: true,
    username: "tester",
    telegramDm: { state: "not_started", botUsername: "sender_bot" },
};

// A reply the test resolves by hand, to hold a request in flight.
function deferred() {
    let release!: (r: { status?: number; body?: unknown }) => void;
    const promise = new Promise<{ status?: number; body?: unknown }>((res) => { release = res; });
    return { reply: () => promise, release };
}

const widgetScript = () => document.querySelector("script[data-telegram-login]");

async function mount(locale: "en" | "es" | "fr" = "en") {
    const utils = renderWithIntl(<TelegramLinker />, { locale });
    await flush();
    return utils;
}

async function startWaiting(utils: Awaited<ReturnType<typeof mount>>) {
    fireEvent.click(utils.getByText(M.appLink));
    await flush();
}

beforeEach(() => {
    vi.useFakeTimers();
    resetRoutes();
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
        const key = `${init?.method ?? "GET"} ${url}`;
        calls.push(key);
        const found = routes[key];
        if (!found || found === "throw") throw new Error("network");
        const reply = typeof found === "function" ? await found() : found;
        const status = reply.status ?? 200;
        return { ok: status < 400, status, json: async () => reply.body ?? {} };
    }));
    vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("TelegramLinker", () => {
    it("renders nothing when Telegram is not configured", async () => {
        routes["GET /api/telegram/account"] = { body: { enabled: false, connected: false } };
        const { container } = await mount();
        expect(container.firstChild).toBeNull();
    });

    it("shows a retry after a failed first load, then the widget with the locale", async () => {
        routes["GET /api/telegram/account"] = { status: 500 };
        const utils = await mount("fr");
        const fr = CATALOGS.fr.telegramLink;
        expect(utils.getByText(fr.loadFailed)).toBeTruthy();
        expect(widgetScript()).toBeNull();

        routes["GET /api/telegram/account"] = { body: account };
        fireEvent.click(utils.getByText(fr.retry));
        await flush();
        expect(widgetScript()?.getAttribute("data-lang")).toBe("fr");
        expect(widgetScript()?.getAttribute("data-telegram-login")).toBe("login_bot");
    });

    it("keeps the card and the widget script when a poll fails", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/account"] = { status: 500 };
        await tick();
        expect(utils.getByText(M.appLinkWaiting)).toBeTruthy();
        expect(widgetScript()).not.toBeNull();
    });

    it("keeps the Connect prompt when a later pending poll fails", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = { body: { pending: { username: "someone", name: null } } };
        await tick();
        expect(utils.getByText(M.appLinkConfirm)).toBeTruthy();
        routes["GET /api/telegram/link/pending"] = { status: 500 };
        await tick();
        expect(utils.getByText(M.appLinkConfirm)).toBeTruthy();
    });

    it("keeps waiting and shows an error when Cancel fails", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = { body: { pending: { username: "someone", name: null } } };
        await tick();
        routes["POST /api/telegram/link/pending"] = { status: 500 };
        fireEvent.click(utils.getByText(M.appLinkDeny));
        await flush();
        expect(utils.getByRole("alert").textContent).toBe(M.actionFailed);
        expect(utils.getByText(M.appLinkConfirm)).toBeTruthy();
    });

    it("shows the translated error and goes idle when confirm returns 409", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = { body: { pending: { username: "someone", name: null } } };
        await tick();
        routes["POST /api/telegram/link/pending"] = { status: 409, body: { error: "English only", code: "already_linked" } };
        fireEvent.click(utils.getByText(M.appLinkConfirm));
        await flush();
        expect(utils.getByRole("alert").textContent).toBe(M.errAlreadyLinked);
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
        expect(utils.getByText(M.appLink)).toBeTruthy();
    });

    it("does not show an old Connect prompt on a new attempt after a timeout", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = prompt;
        await tick();
        expect(utils.getByText(M.appLinkConfirm)).toBeTruthy();
        // Leave the waiting step by timing out, with the prompt still showing.
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
        expect(utils.getByRole("alert").textContent).toBe(M.appLinkTimeout);
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
        // The server still reports the old pending, but no poll has run yet for the new attempt.
        await startWaiting(utils);
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
        expect(utils.getByText(M.appLinkWaiting)).toBeTruthy();
    });

    it("stops waiting with an error after 10 minutes", async () => {
        const utils = await mount();
        await startWaiting(utils);
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 3000); });
        expect(utils.getByRole("alert").textContent).toBe(M.appLinkTimeout);
        expect(utils.getByText(M.appLink)).toBeTruthy();
    });

    it("stops polling on a 401 from the account poll", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/account"] = { status: 401 };
        await tick();
        expect(utils.getByRole("alert").textContent).toBe(M.errSessionExpired);
        const before = calls.length;
        await tick();
        await tick();
        expect(calls.length).toBe(before);
    });

    it("ignores widget logins while the app flow is waiting", async () => {
        const utils = await mount();
        await startWaiting(utils);
        expect(window.onTelegramAuth).toBeDefined();
        await act(async () => { await window.onTelegramAuth?.({ id: 1 }); });
        expect(calls).not.toContain("POST /api/telegram/account");
    });

    it("ignores a poll that was in flight when waiting was cancelled", async () => {
        const utils = await mount();
        await startWaiting(utils);
        const slow = deferred();
        routes["GET /api/telegram/link/pending"] = slow.reply;
        await tick();
        fireEvent.click(utils.getByText(M.appLinkCancel));
        await flush();
        await startWaiting(utils);
        slow.release(prompt);
        await flush();
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
    });

    it("disables the app link while a widget login is in flight", async () => {
        const slow = deferred();
        const utils = await mount();
        routes["POST /api/telegram/account"] = slow.reply;
        act(() => { void window.onTelegramAuth?.({ id: 1 }); });
        await flush();
        expect(utils.getByText(M.linking)).toBeTruthy();
        expect((utils.getByText(M.appLink) as HTMLButtonElement).disabled).toBe(true);
        slow.release({ body: { ok: true } });
        await flush();
    });

    it("disables Connect and Cancel while a confirm is in flight", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = prompt;
        await tick();
        const slow = deferred();
        routes["POST /api/telegram/link/pending"] = slow.reply;
        fireEvent.click(utils.getByText(M.appLinkConfirm));
        await flush();
        expect((utils.getByText(M.appLinkConnecting) as HTMLButtonElement).disabled).toBe(true);
        expect((utils.getByText(M.appLinkDeny) as HTMLButtonElement).disabled).toBe(true);
        slow.release({ body: { ok: true } });
        await flush();
    });

    it("leaves waiting and says so when a confirm worked but the reload failed", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = prompt;
        await tick();
        routes["GET /api/telegram/account"] = { status: 500 };
        fireEvent.click(utils.getByText(M.appLinkConfirm));
        await flush();
        expect(utils.getByRole("alert").textContent).toBe(M.errReload);
        expect(utils.queryByText(M.appLinkCancel)).toBeNull();
        expect(utils.getByText(M.appLink)).toBeTruthy();
    });

    it("does not claim anything was saved when a cancel's reload fails", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = prompt;
        await tick();
        routes["GET /api/telegram/account"] = { status: 500 };
        fireEvent.click(utils.getByText(M.appLinkDeny));
        await flush();
        expect(utils.queryByRole("alert")).toBeNull();
    });

    describe("connected DM row", () => {
        beforeEach(() => {
            routes["GET /api/telegram/account"] = { body: connected };
        });

        it("says so when a check leaves the state unchanged", async () => {
            routes["POST /api/telegram/account/check"] = { body: { state: "not_started" } };
            const utils = await mount();
            fireEvent.click(utils.getByText(M.dmCheck));
            await flush();
            expect(utils.getByText(M.dmStillNo)).toBeTruthy();
        });

        it("falls back to the reported state when the reload fails", async () => {
            const utils = await mount();
            routes["POST /api/telegram/account/check"] = { body: { state: "not_started" } };
            routes["GET /api/telegram/account"] = { status: 500 };
            fireEvent.click(utils.getByText(M.dmCheck));
            await flush();
            expect(utils.getByText(M.dmStillNo)).toBeTruthy();
        });

        it("shows an error when nothing says what the state is", async () => {
            const utils = await mount();
            routes["POST /api/telegram/account/check"] = { body: {} };
            routes["GET /api/telegram/account"] = { status: 500 };
            fireEvent.click(utils.getByText(M.dmCheck));
            await flush();
            expect(utils.getByRole("alert").textContent).toBe(M.dmCheckFailed);
        });

        it("clears the check note on disconnect", async () => {
            routes["POST /api/telegram/account/check"] = { body: { state: "not_started" } };
            const utils = await mount();
            fireEvent.click(utils.getByText(M.dmCheck));
            await flush();
            routes["DELETE /api/telegram/account"] = { body: { ok: true } };
            routes["GET /api/telegram/account"] = { body: account };
            fireEvent.click(utils.getByText(M.unlink));
            await flush();
            expect(utils.queryByText(M.dmStillNo)).toBeNull();
        });
    });

    it("links to the sender bot, outside the status region, when it has not been started", async () => {
        routes["GET /api/telegram/host-match"] = { body: { enabled: true, state: "pending", handleHint: "ab", canSend: true } };
        routes["POST /api/telegram/host-match"] = { body: { result: "not-started", senderBot: "sender_bot" } };
        const utils = await mount();
        fireEvent.click(utils.getByText(M.matchYes));
        await flush();
        const link = utils.getByText(M.dmOpen) as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("https://t.me/sender_bot");
        expect(link.closest('[role="status"]')).toBeNull();
    });

    it("stops polling and shows a session error on 401", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = { status: 401 };
        await tick();
        expect(utils.getByRole("alert").textContent).toBe(M.errSessionExpired);
        const before = calls.filter((c) => c === "GET /api/telegram/link/pending").length;
        await tick();
        await tick();
        expect(calls.filter((c) => c === "GET /api/telegram/link/pending").length).toBe(before);
    });
});
