import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import LiveCallBanner from "./LiveCallBanner";

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("<LiveCallBanner />", () => {
    beforeEach(() => vi.unstubAllGlobals());
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("links to /calls/live with the call title while a call is live", async () => {
        const f = respond({ calls: [{ title: "Community Call", crewLabel: "Community" }], pollSeconds: 10 });
        vi.stubGlobal("fetch", f);
        renderWithIntl(<LiveCallBanner />);
        const banner = await screen.findByTestId("live-call-banner");
        expect(banner).toHaveAttribute("href", "/calls/live");
        expect(banner.textContent).toContain("Live now: Community Call");
        expect(f).toHaveBeenCalledWith("/api/calls/live/public");
    });

    it("mentions the other calls when several are live", async () => {
        vi.stubGlobal("fetch", respond({ calls: [{ title: "Ops call", crewLabel: "Ops" }, { title: "LATAM call", crewLabel: "LATAM" }], pollSeconds: 10 }));
        renderWithIntl(<LiveCallBanner />);
        const banner = await screen.findByTestId("live-call-banner");
        expect(banner.textContent).toContain("Live now: Ops call and 1 more call");
    });

    it("renders nothing when no call is live, and on any failure", async () => {
        vi.stubGlobal("fetch", respond({ calls: [], pollSeconds: 10 }));
        renderWithIntl(<LiveCallBanner />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByTestId("live-call-banner")).toBeNull();
        cleanup();
        vi.stubGlobal("fetch", respond({}, false));
        renderWithIntl(<LiveCallBanner />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByTestId("live-call-banner")).toBeNull();
        cleanup();
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        renderWithIntl(<LiveCallBanner />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByTestId("live-call-banner")).toBeNull();
    });

    it("is wired into /calls and the dashboard, which are otherwise unchanged", async () => {
        const { readFileSync } = await import("fs");
        const { join } = await import("path");
        const root = join(__dirname, "..", "..");
        expect(readFileSync(join(root, "calls", "page.tsx"), "utf-8")).toContain("<LiveCallBanner");
        expect(readFileSync(join(root, "dashboard", "[id]", "page.tsx"), "utf-8")).toContain("<LiveCallBanner");
    });
});
