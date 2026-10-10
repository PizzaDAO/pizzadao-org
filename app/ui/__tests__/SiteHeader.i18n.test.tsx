import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const state = vi.hoisted(() => ({ path: "/missions", session: { authenticated: true, memberId: "42", canManageShop: false } }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/app/lib/hooks/use-session", () => ({ useSession: () => ({ data: state.session }) }));
import SiteHeader from "../SiteHeader";

afterEach(cleanup);
beforeEach(() => { state.path = "/missions"; state.session = { authenticated: true, memberId: "42", canManageShop: false }; });

describe("grouped site navigation", () => {
  it("translates groups, destinations and active routes in Spanish", () => {
    renderWithIntl(<SiteHeader />, { locale: "es" });
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Contribuir" }));
    expect(screen.getByRole("link", { name: "Misiones" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ganar y gastar PEP" })).toHaveAttribute("href", "/pep");
    fireEvent.click(screen.getByRole("button", { name: "Comunidad" }));
    expect(screen.getByRole("link", { name: "Miembros" })).toHaveAttribute("href", "/crew");
    expect(screen.queryByRole("link", { name: "Misiones" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recursos" }));
    expect(screen.getByRole("link", { name: "Roles (Turtles)" })).toHaveAttribute("href", "/turtles");
    expect(screen.getByRole("link", { name: "Material impreso" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mi panel" })).toHaveAttribute("href", "/dashboard/42");
  });

  it("returns keyboard focus to the group toggle when Escape closes it", () => {
    renderWithIntl(<SiteHeader />);
    const button = screen.getByRole("button", { name: "Community" });
    fireEvent.click(button);
    screen.getByRole("link", { name: "Members" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  });

  it("shows the same groups in the French mobile menu", () => {
    renderWithIntl(<SiteHeader />, { locale: "fr" });
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    expect(screen.getByRole("link", { name: "Historique des appels" })).toHaveAttribute("href", "/calls");
    expect(screen.getByRole("heading", { name: "Communauté" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toHaveFocus();
  });

  it("offers public exploration on the homepage and hides member-only destinations", () => {
    state.path = "/"; state.session = { authenticated: false, memberId: "", canManageShop: false };
    renderWithIntl(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Community" }));
    expect(screen.getByRole("link", { name: "Crews" })).toHaveAttribute("href", "/crews");
    expect(screen.queryByRole("link", { name: "Chats" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    fireEvent.click(screen.getByRole("button", { name: "Resources" }));
    expect(screen.queryByRole("link", { name: "Shop admin" })).not.toBeInTheDocument();
  });

  it("marks nested crew routes active and preserves shop permissions", () => {
    state.path = "/crew/tech"; state.session.canManageShop = true;
    renderWithIntl(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Community" }));
    expect(screen.getByRole("link", { name: "Crews" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Resources" }));
    expect(screen.getByRole("link", { name: "Shop admin" })).toHaveAttribute("href", "/admin/shop");
  });
});
