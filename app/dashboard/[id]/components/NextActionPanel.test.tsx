// app/dashboard/[id]/components/NextActionPanel.test.tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Render next/link as a plain anchor so href shows up in the DOM.
vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

import { NextActionPanel } from "./NextActionPanel";
import type { NextAction } from "../lib/next-action";

const SNOOZE_PREFIX = "dashboard-next-action-snooze-";

function makeAction(overrides: Partial<NextAction> = {}): NextAction {
    return {
        kind: "submit_mission",
        headline: "Your next mission is ready",
        body: "Post your first vouch",
        primaryCta: { label: "Submit Level 2 mission", href: "/missions#mission-14" },
        ...overrides,
    } as NextAction;
}

describe("<NextActionPanel />", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("renders the join_crew variant", () => {
        const a = makeAction({
            kind: "join_crew",
            headline: "Welcome — pick a crew to get started",
            body: "Crews are how members coordinate work across the DAO.",
            primaryCta: { label: "Join your first crew", href: "/crew" },
        });
        render(<NextActionPanel nextAction={a} />);

        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
            "Welcome — pick a crew to get started",
        );
        expect(screen.getByText("Crews are how members coordinate work across the DAO."))
            .toBeInTheDocument();
        const cta = screen.getByRole("link", { name: "Join your first crew" });
        expect(cta).toHaveAttribute("href", "/crew");
        expect(screen.getByTestId("next-action-panel"))
            .toHaveAttribute("data-kind", "join_crew");
    });

    it("renders the connect_wallet variant", () => {
        const a = makeAction({
            kind: "connect_wallet",
            headline: "Link a wallet to display your PizzaDAO POAPs and NFTs",
            body: undefined,
            primaryCta: { label: "Connect a wallet", href: "/profile/42" },
        });
        render(<NextActionPanel nextAction={a} />);
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
            "Link a wallet to display your PizzaDAO POAPs and NFTs",
        );
        const cta = screen.getByRole("link", { name: "Connect a wallet" });
        expect(cta).toHaveAttribute("href", "/profile/42");
    });

    it("renders the submit_mission variant with body text", () => {
        render(<NextActionPanel nextAction={makeAction()} />);
        expect(screen.getByText("Post your first vouch")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Submit Level/ })).toHaveAttribute(
            "href",
            "/missions#mission-14",
        );
    });

    it("renders the power_user_review variant", () => {
        const a = makeAction({
            kind: "power_user_review",
            headline: "You're set. Pay it forward.",
            body: "Help review pending missions.",
            primaryCta: { label: "Help review missions", href: "/missions" },
        });
        render(<NextActionPanel nextAction={a} />);
        expect(screen.getByTestId("next-action-panel")).toHaveAttribute(
            "data-kind",
            "power_user_review",
        );
        expect(screen.getByRole("link", { name: "Help review missions" }))
            .toHaveAttribute("href", "/missions");
    });

    it("renders an optional secondary link when provided", () => {
        const a = makeAction({
            secondary: { label: "Snooze for now", href: "/dashboard" },
        });
        render(<NextActionPanel nextAction={a} />);
        expect(screen.getByRole("link", { name: "Snooze for now" })).toHaveAttribute(
            "href",
            "/dashboard",
        );
    });

    it("snoozes the panel for 24h and shows a recovery link", async () => {
        render(<NextActionPanel nextAction={makeAction()} />);

        // The headline is initially visible.
        expect(screen.getByTestId("next-action-panel")).toBeInTheDocument();

        // Click "Not now" to snooze.
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Snooze next action/i }));
        });

        // Panel is gone, "Show next action again" link is up.
        expect(screen.queryByTestId("next-action-panel")).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /Show next action again/i }),
        ).toBeInTheDocument();

        // localStorage holds a future ISO date.
        const stored = window.localStorage.getItem(
            `${SNOOZE_PREFIX}submit_mission`,
        );
        expect(stored).toBeTruthy();
        expect(Date.parse(stored!)).toBeGreaterThan(Date.now());
    });

    it("hides the panel on initial render when localStorage has a future snooze", () => {
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        window.localStorage.setItem(`${SNOOZE_PREFIX}submit_mission`, future);

        render(<NextActionPanel nextAction={makeAction()} />);

        // Effect hydrates and removes the panel; recovery link appears.
        expect(screen.queryByTestId("next-action-panel")).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /Show next action again/i }),
        ).toBeInTheDocument();
    });

    it("ignores expired snooze entries", () => {
        const past = new Date(Date.now() - 60 * 1000).toISOString();
        window.localStorage.setItem(`${SNOOZE_PREFIX}submit_mission`, past);

        render(<NextActionPanel nextAction={makeAction()} />);
        // Expired snooze: panel renders normally.
        expect(screen.getByTestId("next-action-panel")).toBeInTheDocument();
    });

    it("clears the snooze when 'Show again' is clicked", async () => {
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        window.localStorage.setItem(`${SNOOZE_PREFIX}submit_mission`, future);

        render(<NextActionPanel nextAction={makeAction()} />);

        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: /Show next action again/i }),
            );
        });

        expect(
            window.localStorage.getItem(`${SNOOZE_PREFIX}submit_mission`),
        ).toBeNull();
        expect(screen.getByTestId("next-action-panel")).toBeInTheDocument();
    });

    it("scopes snooze per-kind — escalating action shows after unrelated snooze", () => {
        // Snooze "connect_wallet"; render a different kind. Panel should
        // still render.
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        window.localStorage.setItem(`${SNOOZE_PREFIX}connect_wallet`, future);

        render(<NextActionPanel nextAction={makeAction({ kind: "connect_x" })} />);
        const panel = screen.getByTestId("next-action-panel");
        expect(panel).toHaveAttribute("data-kind", "connect_x");
    });
});
