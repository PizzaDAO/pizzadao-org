import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

import { LaneStepItem, PinButton } from "./LaneClient";

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
});

function renderStep(props: Partial<React.ComponentProps<typeof LaneStepItem>> = {}) {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
        <QueryClientProvider client={client}>
            <LaneStepItem
                slug="host"
                memberId="m1"
                stepId="s1"
                index={1}
                title="Step"
                kind="do"
                initialDone={false}
                linkHref={null}
                linkLabel={null}
                markDone="Mark done"
                markUndone="Mark not done"
                submitHint="Submit the mission"
                submitHref="/missions#mission-7"
                submitLabel="Submit the mission"
                errorLabel="Could not save"
                {...props}
            />
        </QueryClientProvider>,
    );
    return { invalidate };
}

describe("<LaneStepItem /> links", () => {
    it("a submit step always links to the mission, ignoring an admin-set link", () => {
        renderStep({ kind: "submit", linkHref: "https://evil.example/x", linkLabel: "Elsewhere" });
        const link = screen.getByRole("link", { name: "Submit the mission" });
        expect(link).toHaveAttribute("href", "/missions#mission-7");
        expect(link).not.toHaveAttribute("target");
        expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    });

    it("a submit step has no link when the mission is not active (no href passed)", () => {
        renderStep({ kind: "submit", submitHref: null, linkHref: "/crews", linkLabel: "Crews" });
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("a normal step still uses its own link, external ones in a new tab", () => {
        renderStep({ linkHref: "https://example.org/guide", linkLabel: "Read it" });
        const link = screen.getByRole("link", { name: "Read it" });
        expect(link).toHaveAttribute("href", "https://example.org/guide");
        expect(link).toHaveAttribute("target", "_blank");
    });
});

describe("dashboard refresh after a write", () => {
    it("ticking a step re-fetches the dashboard summary past the HTTP cache and marks it stale", async () => {
        const { invalidate } = renderStep();
        fireEvent.click(screen.getByRole("checkbox"));
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard-summary"] }));
        const urls = fetchMock.mock.calls.map((c) => c[0]);
        expect(urls).toContain("/api/lanes/progress");
        const summary = fetchMock.mock.calls.find((c) => String(c[0]).startsWith("/api/dashboard-summary"));
        expect(summary?.[0]).toBe("/api/dashboard-summary?memberId=m1&fresh=1");
        expect(summary?.[1]).toMatchObject({ cache: "reload" });
    });

    it("a failed tick does not refresh the summary", async () => {
        fetchMock.mockResolvedValue({ ok: false });
        const { invalidate } = renderStep();
        fireEvent.click(screen.getByRole("checkbox"));
        await screen.findByRole("alert");
        expect(invalidate).not.toHaveBeenCalled();
    });

    it("pinning refreshes the summary", async () => {
        const client = new QueryClient();
        const invalidate = vi.spyOn(client, "invalidateQueries");
        render(
            <QueryClientProvider client={client}>
                <PinButton slug="host" memberId="m1" label="Make this my lane" busyLabel="Saving" errorLabel="Could not save" />
            </QueryClientProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Make this my lane" }));
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard-summary"] }));
    });
});
