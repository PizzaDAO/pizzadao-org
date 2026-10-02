// app/dashboard/[id]/components/ProfileCompleteCelebrationGate.test.tsx
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ProfileCompleteCelebrationGate } from "./ProfileCompleteCelebrationGate";
import { getProfileCompletion } from "../lib/profile-completion";

const complete = getProfileCompletion({
    member: { id: "42", crews: ["tech"] },
    wallets: { count: 1 },
    x: { connected: true },
});
const incomplete = getProfileCompletion({
    member: { id: "42", crews: ["tech"] },
    wallets: { count: 1 },
    x: { connected: false },
});

function mockFetch(body: Record<string, unknown>, ok = true) {
    const fn = vi.fn().mockResolvedValue({ ok, json: async () => body });
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
}

beforeEach(() => {
    window.localStorage.clear();
});
afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
});

describe("ProfileCompleteCelebrationGate", () => {
    it("does nothing while the profile is incomplete", async () => {
        const fetchMock = mockFetch({ profileCompletedClaimed: true });
        render(<ProfileCompleteCelebrationGate memberId="42" completion={incomplete} />);
        await new Promise((r) => setTimeout(r, 10));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("claims the flag and shows the overlay when this request flipped it", async () => {
        const fetchMock = mockFetch({
            profileCompletedClaimed: true,
            profileCompletedCelebratedAt: "2026-09-29T00:00:00.000Z",
        });
        render(<ProfileCompleteCelebrationGate memberId="42" completion={complete} />);
        expect(await screen.findByRole("dialog")).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/missions/celebration");
        expect(JSON.parse(init.body)).toEqual({ profileCompleted: true });
        expect(window.localStorage.getItem("pizzadao:profile-complete-celebrated:42")).toBe("1");
    });

    it("stays hidden when already celebrated (e.g. backfilled at deploy)", async () => {
        const fetchMock = mockFetch({
            profileCompletedClaimed: false,
            profileCompletedCelebratedAt: "2026-09-01T00:00:00.000Z",
        });
        render(<ProfileCompleteCelebrationGate memberId="42" completion={complete} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(window.localStorage.getItem("pizzadao:profile-complete-celebrated:42")).toBe("1"),
        );
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("skips the request entirely when the browser memo is set", async () => {
        window.localStorage.setItem("pizzadao:profile-complete-celebrated:42", "1");
        const fetchMock = mockFetch({ profileCompletedClaimed: true });
        render(<ProfileCompleteCelebrationGate memberId="42" completion={complete} />);
        await new Promise((r) => setTimeout(r, 10));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
