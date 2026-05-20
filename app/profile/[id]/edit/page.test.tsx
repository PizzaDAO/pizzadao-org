// app/profile/[id]/edit/page.test.tsx
//
// Owner-only access gate for /profile/[id]/edit.
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

// EditClient pulls in React Query + a host of UI deps that aren't relevant to
// the auth gate. Stub it to a leaf that's easy to assert on.
vi.mock("./EditClient", () => ({
    EditClient: ({ memberId }: { memberId: string }) => (
        <div data-testid="edit-client">EDIT_CLIENT_FOR:{memberId}</div>
    ),
}));

import EditProfilePage from "./page";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

async function renderPage(id: string) {
    // Server components return a React tree we can render directly after
    // awaiting the async function.
    const tree = await EditProfilePage({ params: Promise.resolve({ id }) });
    render(tree as React.ReactElement);
}

describe("/profile/[id]/edit (owner-only access gate)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders 403 when there is no session", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await renderPage("69");

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
        expect(screen.queryByTestId("edit-client")).not.toBeInTheDocument();
    });

    it("renders 403 when the viewer's memberId does not match", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-other",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue("42");

        await renderPage("69");

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
        expect(
            screen.getByText(/You can only edit your own profile/i),
        ).toBeInTheDocument();
        expect(screen.queryByTestId("edit-client")).not.toBeInTheDocument();
    });

    it("renders the EditClient when the viewer owns the requested memberId", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-69",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue("69");

        await renderPage("69");

        expect(screen.queryByText(/403 — Forbidden/)).not.toBeInTheDocument();
        expect(screen.getByTestId("edit-client")).toHaveTextContent(
            "EDIT_CLIENT_FOR:69",
        );
    });

    it("renders 403 when the viewer's memberId can't be resolved", async () => {
        (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            discordId: "discord-orphan",
        });
        (fetchMemberIdByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        await renderPage("69");

        expect(screen.getByText(/403 — Forbidden/)).toBeInTheDocument();
    });
});
