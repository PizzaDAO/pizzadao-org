// app/dashboard/[id]/components/ProfileCompletionMeter.test.tsx
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProfileCompletionMeter } from "./ProfileCompletionMeter";
import { getProfileCompletion } from "../lib/profile-completion";

afterEach(cleanup);

describe("ProfileCompletionMeter", () => {
    it("shows N of M and links to the next incomplete step", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 0 },
            x: { connected: false },
        });
        render(<ProfileCompletionMeter completion={completion} />);
        expect(screen.getByText(/1 of 3 done/)).toBeTruthy();
        const bar = screen.getByRole("progressbar", { name: "Profile setup" });
        expect(bar.getAttribute("aria-valuenow")).toBe("1");
        expect(bar.getAttribute("aria-valuemax")).toBe("3");
        const link = screen.getByRole("link", { name: /Next: Connect a wallet/ });
        expect(link.getAttribute("href")).toBe("/profile/42");
    });

    it("uses a plain anchor for the X OAuth /api route", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 1 },
            x: { connected: false },
        });
        render(<ProfileCompletionMeter completion={completion} />);
        const link = screen.getByRole("link", { name: /Next: Connect X/ });
        expect(link.getAttribute("href")).toBe("/api/x/login?memberId=42");
    });

    it("renders nothing once the profile is complete", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 1 },
            x: { connected: true },
        });
        const { container } = render(<ProfileCompletionMeter completion={completion} />);
        expect(container.innerHTML).toBe("");
    });

    it("renders nothing while the summary is loading", () => {
        const { container } = render(<ProfileCompletionMeter completion={undefined} />);
        expect(container.innerHTML).toBe("");
    });
});
