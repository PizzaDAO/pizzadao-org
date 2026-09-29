// app/me/wallets/page.test.tsx
//
// Owner-only access gate for /me/wallets.
//
// Plan: plans/garlic-96648-dashboard-redesign.md §7 — PR5 (slice-61816).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/lib/session", () => ({
    getSession: vi.fn(),
}));

vi.mock("@/app/lib/sheets/member-repository", () => ({
    fetchMemberIdByDiscordId: vi.fn(),
}));

// WalletsClient pulls in wagmi / rainbowkit — stub it down so the auth gate
// is the only thing under test here.
vi.mock("./WalletsClient", () => ({
    WalletsClient: ({ memberId }: { memberId: string }) => (
        <div data-testid="wallets-client">WALLETS_CLIENT_FOR:{memberId}</div>
    ),
}));

import MyWalletsPage from "./page";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

async function renderPage(query?: Record<string, string>) {
    const tree = await MyWalletsPage({
        searchParams: Promise.resolve(query ?? {}),
    });
    render(tree as React.ReactElement);
}

describe("/me/wallets (owner-only access gate)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders 403 when there is no session", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await renderPage();

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
        expect(screen.queryByTestId("wallets-client")).not.toBeInTheDocument();
    });

    it("renders 403 when memberId can't be resolved from the session", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-orphan",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await renderPage();

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
    });

    it("renders the WalletsClient for the viewer's own memberId", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue("69");

        await renderPage();

        expect(screen.queryByText(/403 — Forbidden/)).not.toBeInTheDocument();
        expect(screen.getByTestId("wallets-client")).toHaveTextContent(
            "WALLETS_CLIENT_FOR:69",
        );
    });

    it("renders 403 when ?memberId= doesn't match the viewer's memberId", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue("69");

        await renderPage({ memberId: "42" });

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
        expect(screen.queryByTestId("wallets-client")).not.toBeInTheDocument();
    });
});
