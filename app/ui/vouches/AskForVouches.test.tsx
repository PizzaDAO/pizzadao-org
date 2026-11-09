import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

import { AskForVouches } from "./AskForVouches";

const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;

describe("<AskForVouches />", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("shares the public profile link with the vouch message (copy fallback)", async () => {
        fetchMock.mockResolvedValue(json(200, { enabled: false }));
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        renderWithIntl(<AskForVouches memberId="42" />);
        fireEvent.click(screen.getByRole("button", { name: /ask for vouches/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = (writeText.mock.calls[0] as unknown as [string])[0];
        expect(copied).toMatch(/^Vouch for me on PizzaDAO: .*\/profile\/42$/);
        expect(copied).not.toContain("/dashboard");
    });

    it("hides the member request picker while the setting is off", async () => {
        fetchMock.mockResolvedValue(json(200, { enabled: false }));
        renderWithIntl(<AskForVouches memberId="42" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByLabelText(/ask a member/i)).toBeNull();
    });

    it("searches, sends a request to the picked member and reports a duplicate", async () => {
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === "/api/vouches/request" && init?.method !== "POST") return json(200, { enabled: true });
            if (String(url).startsWith("/api/referrals/inviters")) return json(200, { members: [{ memberId: "7", name: "Friend", city: null }, { memberId: "42", name: "Me", city: null }] });
            if (url === "/api/vouches/request" && init?.method === "POST") return json(409, { reason: "pending" });
            return json(404, {});
        });
        renderWithIntl(<AskForVouches memberId="42" />);
        const input = await screen.findByLabelText(/ask a member/i);
        fireEvent.change(input, { target: { value: "fri" } });
        const send = await screen.findByRole("button", { name: /send request/i });
        expect(screen.queryByText("Me")).toBeNull();
        fireEvent.click(send);
        await screen.findByText(/already have an open request/i);
        const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
        expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ targetMemberId: "7" });
    });
});
