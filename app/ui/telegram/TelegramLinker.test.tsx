// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { CATALOGS, renderWithIntl } from "@/app/lib/i18n/test-utils";
import { TelegramLinker } from "./TelegramLinker";

const M = CATALOGS.en.telegramLink;

type Reply = { status?: number; body?: unknown } | "throw";
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
        const reply = routes[key];
        if (!reply || reply === "throw") throw new Error("network");
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

    it("clears a stale pending prompt when a new attempt starts", async () => {
        const utils = await mount();
        await startWaiting(utils);
        routes["GET /api/telegram/link/pending"] = { body: { pending: { username: "someone", name: null } } };
        await tick();
        fireEvent.click(utils.getByText(M.appLinkDeny));
        await flush();
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
        await startWaiting(utils);
        // The server still answers with the old pending, but no poll has run yet for this attempt.
        expect(utils.queryByText(M.appLinkConfirm)).toBeNull();
        expect(utils.getByText(M.appLinkWaiting)).toBeTruthy();
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
