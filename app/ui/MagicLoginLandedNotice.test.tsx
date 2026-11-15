import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => "/calls/live",
}));
import { MagicLoginLandedNotice } from "./MagicLoginLandedNotice";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<MagicLoginLandedNotice />", () => {
  it("tells a member the link logged in THIS browser, and strips the flag", () => {
    nav.params = new URLSearchParams("tab=1&magicLogin=elsewhere");
    renderWithIntl(<MagicLoginLandedNotice />);
    expect(screen.getByText("You're logged in in this browser.")).toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith("/calls/live?tab=1", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("You're logged in in this browser.")).not.toBeInTheDocument();
  });
  it("stays hidden on a normal page load", () => {
    nav.params = new URLSearchParams("tab=1");
    renderWithIntl(<MagicLoginLandedNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
