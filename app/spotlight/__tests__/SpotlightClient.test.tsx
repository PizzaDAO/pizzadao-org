import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { SpotlightClient } from "../SpotlightClient";

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
            return { ok: true, status: 201, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => ({ submissions: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("SpotlightClient", () => {
    it("toggle hides the nominee fields in self mode", async () => {
        renderWithIntl(<SpotlightClient />);
        expect(screen.queryByLabelText("Nominee's name")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Nominate someone else" }));
        expect(screen.getByLabelText("Nominee's name")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Spotlight myself" }));
        expect(screen.queryByLabelText("Nominee's name")).toBeNull();
        await waitFor(() => expect(screen.getByText("No submissions yet.")).toBeTruthy());
    });

    it("keeps submit disabled until pitch and consent are filled", async () => {
        renderWithIntl(<SpotlightClient />);
        const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/What did they do/), { target: { value: "Built a thing" } });
        expect(submit.disabled).toBe(true);
        fireEvent.click(screen.getByRole("checkbox"));
        expect(submit.disabled).toBe(false);
        await waitFor(() => expect(screen.getByText("No submissions yet.")).toBeTruthy());
    });

    it("shows the success state after a 201", async () => {
        renderWithIntl(<SpotlightClient />);
        fireEvent.change(screen.getByLabelText(/What did they do/), { target: { value: "Built a thing" } });
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: "Submit" }));
        await waitFor(() => expect(screen.getByText(/Your submission is in/)).toBeTruthy());
        const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
        expect(JSON.parse(post![1].body)).toMatchObject({ isSelf: true, pitch: "Built a thing", consent: true });
        expect(screen.getByRole("button", { name: "Submit another" })).toBeTruthy();
    });

    it("maps a 429 to a friendly translated message", async () => {
        fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
            init?.method === "POST"
                ? { ok: false, status: 429, json: async () => ({ error: "x" }) }
                : { ok: true, status: 200, json: async () => ({ submissions: [] }) },
        );
        renderWithIntl(<SpotlightClient />);
        fireEvent.change(screen.getByLabelText(/What did they do/), { target: { value: "Built a thing" } });
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: "Submit" }));
        await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("submission limit"));
    });

    it("renders translated labels in es", async () => {
        renderWithIntl(<SpotlightClient />, { locale: "es" });
        expect(screen.getByRole("button", { name: "Destacarme a mí" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
        await waitFor(() => expect(screen.getByText("Aún no hay envíos.")).toBeTruthy());
    });
});
