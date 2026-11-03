import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

import { QuickVouchButton } from "./QuickVouchButton";
import { VouchedBy } from "./VouchedBy";

const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;

describe("<QuickVouchButton />", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        push.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("one click posts the vouch and flips to Vouched", async () => {
        fetchMock.mockResolvedValueOnce(json(200, { success: true }));
        const onVouched = vi.fn();
        render(<QuickVouchButton targetMemberId="7" vouched={false} onVouched={onVouched} />);
        fireEvent.click(screen.getByRole("button", { name: /Vouch for this member/ }));
        await waitFor(() => expect(onVouched).toHaveBeenCalled());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/vouches/add");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ targetMemberId: "7" });
    });

    it("already vouched is disabled", () => {
        render(<QuickVouchButton targetMemberId="7" vouched onVouched={() => {}} />);
        expect(screen.getByRole("button", { name: "Vouched" })).toBeDisabled();
    });

    it("a 409 (already vouched) counts as vouched; the daily limit shows its message", async () => {
        const onVouched = vi.fn();
        fetchMock.mockResolvedValueOnce(json(409, { error: "Already vouched" }));
        render(<QuickVouchButton targetMemberId="7" vouched={false} onVouched={onVouched} />);
        fireEvent.click(screen.getByRole("button"));
        await waitFor(() => expect(onVouched).toHaveBeenCalled());
        cleanup();
        fetchMock.mockResolvedValueOnce(json(429, { error: "Daily vouch limit reached (5 per day). Try again tomorrow." }));
        const again = vi.fn();
        render(<QuickVouchButton targetMemberId="8" vouched={false} onVouched={again} />);
        fireEvent.click(screen.getByRole("button"));
        expect(await screen.findByRole("alert")).toHaveTextContent(/Daily vouch limit reached/);
        expect(again).not.toHaveBeenCalled();
    });

    it("a disavow-eligible viewer is sent to the profile when the member is listed, and nothing is posted", async () => {
        fetchMock.mockResolvedValueOnce(json(200, { listed: true, id: "x" }));
        render(<QuickVouchButton targetMemberId="7" vouched={false} canViewDisavow onVouched={() => {}} />);
        fireEvent.click(screen.getByRole("button"));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/profile/7"));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain("/api/disavow/check");
    });

    it("everyone else never calls the disavow check", async () => {
        fetchMock.mockResolvedValueOnce(json(200, { success: true }));
        render(<QuickVouchButton targetMemberId="7" vouched={false} onVouched={() => {}} />);
        fireEvent.click(screen.getByRole("button"));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("disavow"))).toBe(true);
    });
});

describe("<VouchedBy />", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("renders nothing while the setting is off", async () => {
        fetchMock.mockResolvedValueOnce(json(200, { enabled: false }));
        renderWithIntl(<VouchedBy memberId="7" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByTestId("vouched-by")).toBeNull();
    });

    it("shows the count and who vouched, linking to their profiles", async () => {
        fetchMock.mockResolvedValueOnce(
            json(200, {
                enabled: true,
                total: 27,
                vouchers: [
                    { memberId: "1", name: "Ada", city: "Rome" },
                    { memberId: "2", name: "Bo", city: "" },
                ],
            }),
        );
        renderWithIntl(<VouchedBy memberId="7" />);
        expect(await screen.findByText("Ada")).toHaveAttribute("href", "/profile/1");
        expect(screen.getByText("Bo")).toHaveAttribute("href", "/profile/2");
        expect(screen.getByText("27 members")).toBeInTheDocument();
        expect(screen.getByText("and 25 more")).toBeInTheDocument();
    });

    it("a failed load shows nothing", async () => {
        fetchMock.mockResolvedValueOnce(json(500, { error: "x" }));
        renderWithIntl(<VouchedBy memberId="7" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByTestId("vouched-by")).toBeNull();
    });
});
