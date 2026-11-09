import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { MagicLoginFlow } from "./MagicLoginFlow";

describe("<MagicLoginFlow /> DMs", () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("tells people up front that DMs must be on, with a no-DM alternative", () => {
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        expect(screen.getByText(/direct messages from server members/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Log in with Discord/ })).toHaveAttribute("href", "/api/discord/login");
    });

    it("explains how to enable DMs on desktop and mobile and offers Discord login when the DM fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ status: "dm_failed" }) })));
        renderWithIntl(<MagicLoginFlow onBack={() => {}} />);
        fireEvent.change(screen.getByLabelText("Discord username"), { target: { value: "someone" } });
        fireEvent.click(screen.getByRole("button", { name: /Send login link/ }));
        await waitFor(() => expect(screen.getByText("On a computer")).toBeInTheDocument());
        expect(screen.getByText("On your phone (Discord app)")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Log in with Discord" })).toHaveAttribute("href", "/api/discord/login");
    });
});
