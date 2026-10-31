// The manual X row hides only when the verified X card is available; stored
// values are never touched. Loading shows a skeleton, failures offer a retry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { SocialAccountLinker } from "./SocialAccountLinker";

let failFirst = false;
let calls = 0;
let stored: { platform: string; handle: string; verified: boolean }[] = [];

beforeEach(() => {
    calls = 0;
    stored = [{ platform: "TWITTER", handle: "someone", verified: false }];
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            calls++;
            if (failFirst && calls === 1) return new Response("{}", { status: 500 });
            return new Response(
                JSON.stringify({ accounts: stored }),
                { status: 200 }
            );
        })
    );
});

describe("SocialAccountLinker", () => {
    it("shows the manual X row when the verified card is unavailable", async () => {
        failFirst = false;
        renderWithIntl(<SocialAccountLinker memberId="1" />);
        const toggle = await screen.findByRole("button", { name: /Social accounts/ });
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(toggle);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByLabelText("X (not verified)")).toBeTruthy();
        expect(screen.getByLabelText("Farcaster")).toBeTruthy();
    });

    it("keeps a stored manual X row (changeable) even when verified X is available", async () => {
        failFirst = false;
        renderWithIntl(<SocialAccountLinker memberId="1" hideManualX />);
        const toggle = await screen.findByRole("button", { name: /Social accounts/ });
        expect(screen.getByText(/@someone/)).toBeTruthy();
        fireEvent.click(toggle);
        expect(screen.getByLabelText("X (not verified)")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    });

    it("hides the manual X row when verified X is available and nothing is stored", async () => {
        failFirst = false;
        stored = [];
        renderWithIntl(<SocialAccountLinker memberId="1" hideManualX />);
        const toggle = await screen.findByRole("button", { name: /Social accounts/ });
        fireEvent.click(toggle);
        expect(screen.queryByLabelText("X (not verified)")).toBeNull();
        expect(screen.getByLabelText("Farcaster")).toBeTruthy();
    });

    it("offers no save for an unchanged stored handle, and Update once it changes", async () => {
        failFirst = false;
        renderWithIntl(<SocialAccountLinker memberId="1" />);
        fireEvent.click(await screen.findByRole("button", { name: /Social accounts/ }));
        const input = screen.getByLabelText("X (not verified)");
        expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
        fireEvent.change(input, { target: { value: "@someone" } });
        expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
        fireEvent.change(input, { target: { value: "someone_else" } });
        expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
        // Farcaster has nothing stored, so it still says Connect.
        expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    });

    it("shows a skeleton while loading and a retry on failure", async () => {
        failFirst = true;
        renderWithIntl(<SocialAccountLinker memberId="1" />);
        expect(screen.getByRole("status")).toBeTruthy();
        expect(await screen.findByRole("alert")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /Social accounts/ })).toBeTruthy()
        );
    });
});
