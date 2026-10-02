// app/ui/__tests__/SiteHeader.i18n.test.tsx
// Nav labels come from the `nav` catalog; brand terms stay untranslated.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

vi.mock("next/navigation", () => ({
    usePathname: () => "/missions",
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/lib/hooks/use-session", () => ({
    useSession: () => ({ data: { authenticated: true, memberId: "42" } }),
}));

import SiteHeader from "../SiteHeader";

afterEach(cleanup);

describe("SiteHeader i18n", () => {
    it("renders Spanish nav labels and keeps brand terms", () => {
        renderWithIntl(<SiteHeader />, { locale: "es" });
        expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Misiones" })).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("link", { name: "Miembros" })).toHaveAttribute("href", "/crew");
        expect(screen.getByRole("link", { name: "PEP" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Mi panel" })).toHaveAttribute("href", "/dashboard/42");

        fireEvent.click(screen.getByRole("button", { name: /Más/ }));
        expect(screen.getByRole("link", { name: "Turtles" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Material impreso" })).toBeInTheDocument();
    });

    it("renders French menu toggle label", () => {
        renderWithIntl(<SiteHeader />, { locale: "fr" });
        expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Appels" })).toHaveAttribute("href", "/calls");
    });

    it("keeps the English labels in en", () => {
        renderWithIntl(<SiteHeader />);
        expect(screen.getByRole("link", { name: "Crews" })).toHaveAttribute("href", "/crews");
        expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });
});
