import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { renderWithIntl as render } from "@/app/lib/i18n/test-utils";
import { EventsAttendedLazy } from "../EventsAttendedLazy";

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let trigger: IOCallback | null = null;

const row = (i: number, badge = "attended") => ({ id: `r${i}`, name: `Party ${i}`, date: "2026-05-22T00:00:00.000Z", year: 2026, city: "Rome", url: `https://rsv.pizza/p${i}`, badge });
const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
    trigger = null;
    class IO {
        constructor(cb: IOCallback) { trigger = cb; }
        observe() {}
        disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", IO);
});
afterEach(() => vi.unstubAllGlobals());

const scrollIntoView = () => act(async () => { trigger?.([{ isIntersecting: true }]); });

describe("EventsAttendedLazy", () => {
    it("fetches nothing until the section scrolls into view", async () => {
        const f = reply({ enabled: true, events: [row(1)], total: 1 });
        vi.stubGlobal("fetch", f);
        render(<EventsAttendedLazy memberId="42" />);
        expect(f).not.toHaveBeenCalled();
        await scrollIntoView();
        await waitFor(() => expect(f).toHaveBeenCalledWith("/api/events-attended/42"));
        expect(await screen.findByText("Party 1")).toBeTruthy();
    });

    it("renders nothing when the feature is disabled", async () => {
        vi.stubGlobal("fetch", reply({ enabled: false, events: [], total: 0 }));
        const { container } = render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.querySelector("section")).toBeNull();
    });

    it("hides the section from visitors when empty", async () => {
        vi.stubGlobal("fetch", reply({ enabled: true, isOwner: false, events: [], total: 0 }));
        const { container } = render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.querySelector("section")).toBeNull();
    });

    it("shows the owner the add-email prompt when empty, and the verify prompt when unverified", async () => {
        vi.stubGlobal("fetch", reply({ enabled: true, isOwner: true, events: [], total: 0, emailState: "none", visibility: "public", link: { available: false, linked: false } }));
        render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        expect(await screen.findByTestId("prompt-email-none")).toBeTruthy();
    });

    it("shows the verify prompt for an unverified email even when there are events", async () => {
        vi.stubGlobal("fetch", reply({ enabled: true, isOwner: true, events: [row(1, "ticket")], total: 1, emailState: "unverified", visibility: "public", link: { available: false, linked: false } }));
        render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        expect(await screen.findByTestId("prompt-email-unverified")).toBeTruthy();
        expect(screen.getByText("Ticket")).toBeTruthy();
    });

    it("shows the first 6 and expands in place", async () => {
        vi.stubGlobal("fetch", reply({ enabled: true, isOwner: false, events: Array.from({ length: 9 }, (_, i) => row(i + 1)), total: 9 }));
        render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        await screen.findByText("Party 1");
        expect(screen.queryByText("Party 7")).toBeNull();
        fireEvent.click(screen.getByText("Show all (9)"));
        expect(screen.getByText("Party 9")).toBeTruthy();
    });

    it("offers Link rsv.pizza account when available, and Unlink when linked", async () => {
        vi.stubGlobal("fetch", reply({ enabled: true, isOwner: true, events: [], total: 0, emailState: "verified", visibility: "public", link: { available: true, linked: false } }));
        const first = render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        const a = await screen.findByTestId("rsv-link-start");
        expect(a.getAttribute("href")).toBe("/api/events-attended/link/start");
        first.unmount();

        let linked = true;
        const f = vi.fn(async (_u: string, init?: RequestInit) => { if (init?.method === "DELETE") linked = false; return new Response(JSON.stringify({ enabled: true, isOwner: true, events: [], total: 0, emailState: "verified", visibility: "public", link: { available: true, linked } }), { status: 200 }); });
        vi.stubGlobal("fetch", f);
        render(<EventsAttendedLazy memberId="42" />);
        await scrollIntoView();
        expect(await screen.findByTestId("rsv-linked")).toBeTruthy();
        fireEvent.click(screen.getByText("Unlink"));
        await waitFor(() => expect(f).toHaveBeenCalledWith("/api/events-attended/link", { method: "DELETE" }));
        expect(await screen.findByTestId("rsv-link-start")).toBeTruthy();
    });
});
