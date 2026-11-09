import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { XFollowNote, xLinkState } from "./XFollowNote";

describe("xLinkState", () => {
    it("maps the mission card state", () => {
        expect(xLinkState(true, undefined)).toBe("linked");
        expect(xLinkState(false, "pass")).toBe("linked");
        expect(xLinkState(false, "fail")).toBe("notLinked");
        expect(xLinkState(false, undefined)).toBe("unchecked");
        expect(xLinkState(false, "unknown")).toBe("unchecked");
    });
});

describe("<XFollowNote />", () => {
    afterEach(cleanup);

    it("says the follow is honor system and links both accounts", () => {
        renderWithIntl(<XFollowNote state="unchecked" />);
        expect(screen.getByText(/honor system/)).toBeInTheDocument();
        const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(hrefs).toEqual(["https://x.com/RarePizzas", "https://x.com/Pizza_DAO"]);
    });

    it("shows the link state", () => {
        renderWithIntl(<XFollowNote state="notLinked" />);
        expect(screen.getByTestId("x-link-state")).toHaveTextContent(/not linked yet/);
        cleanup();
        renderWithIntl(<XFollowNote state="linked" />);
        expect(screen.getByTestId("x-link-state")).toHaveTextContent("X account linked.");
    });

    it("links Connect X to the profile edit page unless already linked", () => {
        renderWithIntl(<XFollowNote state="notLinked" profileEditHref="/profile/m1/edit" />);
        expect(screen.getByRole("link", { name: "Connect X on your profile" })).toHaveAttribute("href", "/profile/m1/edit");
        cleanup();
        renderWithIntl(<XFollowNote state="linked" profileEditHref="/profile/m1/edit" />);
        expect(screen.queryByRole("link", { name: "Connect X on your profile" })).toBeNull();
    });
});
