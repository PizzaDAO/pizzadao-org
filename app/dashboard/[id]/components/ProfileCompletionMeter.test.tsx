// app/dashboard/[id]/components/ProfileCompletionMeter.test.tsx
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { ProfileCompletionMeter } from "./ProfileCompletionMeter";
import { getProfileCompletion } from "../lib/profile-completion";

afterEach(cleanup);

describe("ProfileCompletionMeter", () => {
    it("shows N of M and links to the next incomplete step", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: [] },
            wallets: { count: 0 },
            x: { connected: false },
        });
        renderWithIntl(<ProfileCompletionMeter completion={completion} />);
        expect(screen.getByText(/0 of 1 done/)).toBeTruthy();
        const bar = screen.getByRole("progressbar", { name: "Profile setup" });
        expect(bar.getAttribute("aria-valuenow")).toBe("0");
        expect(bar.getAttribute("aria-valuemax")).toBe("1");
        const link = screen.getByRole("link", { name: /Next: Join a crew/ });
        expect(link.getAttribute("href")).toBe("/crews");
    });

    it("renders nothing once the profile is complete", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 1 },
            x: { connected: true },
        });
        const { container } = renderWithIntl(<ProfileCompletionMeter completion={completion} />);
        expect(container.innerHTML).toBe("");
    });

    it("renders nothing while the summary is loading", () => {
        const { container } = renderWithIntl(<ProfileCompletionMeter completion={undefined} />);
        expect(container.innerHTML).toBe("");
    });
});
