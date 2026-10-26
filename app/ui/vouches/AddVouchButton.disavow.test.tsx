// The vouch confirm dialog appears only for eligible viewers; non-eligible viewers
// never call the check endpoint and see exactly the old behavior. Warn, never block.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const session = vi.hoisted(() => ({ value: { canViewDisavow: undefined as boolean | undefined } }));
vi.mock("@/app/lib/hooks/use-session", () => ({ useSession: () => ({ data: { authenticated: true, ...session.value } }) }));

import { AddVouchButton } from "./AddVouchButton";

const calls: string[] = [];
let listed = true;
beforeEach(() => {
    calls.length = 0;
    listed = true;
    session.value = { canViewDisavow: undefined };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.startsWith("/api/vouches?")) return new Response(JSON.stringify({ vouches: [] }), { status: 200 });
        if (url.startsWith("/api/disavow/check")) return new Response(JSON.stringify(listed ? { listed: true, id: "e1" } : { listed: false }), { status: 200 });
        if (url === "/api/vouches/add") return new Response("{}", { status: 200 });
        return new Response("{}", { status: 404 });
    }));
});

const mount = () => renderWithIntl(<AddVouchButton targetMemberId="7" currentMemberId="42" />);

describe("AddVouchButton disavow warning", () => {
    it("eligible viewer: warns, then 'Vouch anyway' still vouches", async () => {
        session.value = { canViewDisavow: true };
        mount();
        fireEvent.click(await screen.findByText("+ Vouch"));
        expect(await screen.findByRole("dialog")).toBeTruthy();
        expect(calls).not.toContain("POST /api/vouches/add");
        fireEvent.click(screen.getByText("Vouch anyway"));
        await waitFor(() => expect(calls).toContain("POST /api/vouches/add"));
    });

    it("eligible viewer: Cancel does not vouch", async () => {
        session.value = { canViewDisavow: true };
        mount();
        fireEvent.click(await screen.findByText("+ Vouch"));
        fireEvent.click(await screen.findByText("Cancel"));
        expect(calls).not.toContain("POST /api/vouches/add");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("eligible viewer, person not listed: no dialog, vouch goes through", async () => {
        session.value = { canViewDisavow: true };
        listed = false;
        mount();
        fireEvent.click(await screen.findByText("+ Vouch"));
        await waitFor(() => expect(calls).toContain("POST /api/vouches/add"));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("non-eligible viewer: never calls the check endpoint, no dialog", async () => {
        mount();
        fireEvent.click(await screen.findByText("+ Vouch"));
        await waitFor(() => expect(calls).toContain("POST /api/vouches/add"));
        expect(calls.some((c) => c.includes("/api/disavow"))).toBe(false);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
