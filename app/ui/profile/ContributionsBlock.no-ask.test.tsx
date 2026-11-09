import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));
vi.mock("../../lib/hooks/use-api", () => ({ useArticlesByMember: () => ({ data: { articles: [] } }) }));
vi.mock("../vouches/VouchedBy", () => ({ VouchedBy: () => null }));

import { ContributionsBlock } from "./ContributionsBlock";
import { VouchesWidget } from "../vouches/VouchesWidget";

const fetchMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 200, json: async () => ({ vouches: [], counts: { total: 0 }, enabled: true }) }) as Response);

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
});

describe("public profile never shows the vouch-request tools", () => {
    it.each([
        ["ContributionsBlock", () => <ContributionsBlock memberId="42" />],
        ["VouchesWidget", () => <VouchesWidget memberId="42" />],
    ])("%s renders no Ask for vouches button and never calls the request API", async (_n, el) => {
        vi.stubGlobal("fetch", fetchMock);
        renderWithIntl(el());
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByRole("button", { name: /ask for vouches/i })).toBeNull();
        expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/vouches/request"))).toBe(false);
    });
});
