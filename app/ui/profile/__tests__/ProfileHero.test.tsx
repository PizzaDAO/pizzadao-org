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

    // ---- PR4 — tagline rendering (burrata-13316) -------------------------

    it("renders the tagline when present", () => {
        render(
            <ProfileHero
                {...base}
                tagline="I make round food for round people."
                mode="public"
                viewerId={null}
            />,
        );
        expect(
            screen.getByText("I make round food for round people."),
        ).toBeTruthy();
    });

    it("renders nothing in the tagline slot when empty (no placeholder for visitors)", () => {
        const { container } = render(
            <ProfileHero
                {...base}
                tagline=""
                mode="public"
                viewerId={null}
            />,
        );
        // The placeholder text used by the owner editor should never leak
        // into the public hero.
        expect(screen.queryByText(/add a tagline/i)).toBeNull();
        // No <p> child below the <h1> for the tagline.
        const h1 = container.querySelector("h1");
        const sibling = h1?.nextElementSibling;
        // Either there's no sibling at all, or the next element is the
        // identity line (a <div>, not a <p>).
        expect(sibling?.tagName).not.toBe("P");
    });

    it("treats a whitespace-only tagline as empty", () => {
        render(
            <ProfileHero
                {...base}
                tagline="   "
                mode="public"
                viewerId={null}
            />,
        );
        // The ProfileHero guards via `tagline.trim().length > 0`, so a
        // whitespace-only tagline should not render a <p> with empty text.
        const paragraphs = document.querySelectorAll("p");
        const whitespaceOnly = Array.from(paragraphs).some(
            (p) => p.textContent !== null && p.textContent.trim() === "",
        );
        expect(whitespaceOnly).toBe(false);
        // Name still renders.
        expect(screen.getByText("Test Member")).toBeTruthy();
    });

    it("renders null tagline as empty (no crash)", () => {
        render(
            <ProfileHero
                {...base}
                tagline={null}
                mode="public"
                viewerId={null}
            />,
        );
        expect(screen.getByText("Test Member")).toBeTruthy();
    });
});
