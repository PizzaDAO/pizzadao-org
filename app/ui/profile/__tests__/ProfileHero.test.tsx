// app/ui/profile/__tests__/ProfileHero.test.tsx
//
// Plan: truffle-91035 (PR2 — pepperoni-77692). Vouches the primary CTA
// varies by mode and viewer state per plan §6.4.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock SendPepModal — its query client + form aren't relevant to hero tests.
vi.mock("../../economy/SendPepModal", () => ({
    SendPepModal: () => null,
}));

// Mock AddVouchButton: render a sentinel so we can assert its presence.
vi.mock("../../vouches/AddVouchButton", () => ({
    AddVouchButton: ({ targetMemberId, currentMemberId }: { targetMemberId: string; currentMemberId: string | null }) => (
        <span data-testid="add-vouch-button">
            vouch:{targetMemberId}:{currentMemberId ?? "none"}
        </span>
    ),
}));

import { ProfileHero } from "../ProfileHero";

const base = {
    memberId: "14071",
    name: "Test Member",
    pfpUrl: null,
    tagline: "Pizza maker extraordinaire",
    city: "Brooklyn",
    level: 3 as number | string | null,
    levelTitle: "Pizzaiolo",
};

describe("ProfileHero", () => {
    beforeEach(() => {
        // Ensure each test starts with a clean localStorage so the owner
        // banner re-renders predictably.
        try {
            window.localStorage.clear();
        } catch {
            // ignore
        }
    });

    it("owner-readonly mode renders 'Edit on dashboard' CTA", () => {
        render(
            <ProfileHero
                {...base}
                mode="owner-readonly"
                viewerId="14071"
            />,
        );
        const editLink = screen.getByRole("link", { name: /edit on dashboard/i });
        expect(editLink).toBeTruthy();
        expect(editLink.getAttribute("href")).toBe("/dashboard/14071");
        // No vouch button when viewing as owner.
        expect(screen.queryByTestId("add-vouch-button")).toBeNull();
    });

    it("public mode with signed-in stranger renders vouch button", () => {
        render(
            <ProfileHero
                {...base}
                mode="public"
                viewerId="42"
            />,
        );
        const vouchBtn = screen.getByTestId("add-vouch-button");
        expect(vouchBtn.textContent).toContain("vouch:14071:42");
        // Edit-on-dashboard CTA should NOT appear in public mode.
        expect(screen.queryByRole("link", { name: /edit on dashboard/i })).toBeNull();
    });

    it("public mode with no viewer renders 'Sign in to vouch'", () => {
        render(
            <ProfileHero
                {...base}
                mode="public"
                viewerId={null}
            />,
        );
        const signIn = screen.getByRole("link", { name: /sign in to vouch/i });
        expect(signIn).toBeTruthy();
        expect(signIn.getAttribute("href")).toContain("/api/discord/login");
        expect(signIn.getAttribute("href")).toContain(encodeURIComponent("/profile/14071"));
    });

    it("owner banner is suppressed when suppressOwnerBanner is true", () => {
        render(
            <ProfileHero
                {...base}
                mode="owner-readonly"
                viewerId="14071"
                suppressOwnerBanner
            />,
        );
        expect(screen.queryByText(/this is your public profile/i)).toBeNull();
    });
});
