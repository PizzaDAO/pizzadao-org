import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { StartHere } from "./StartHere";

const base = { enabled: true, memberId: "123", level: 1, mission: { state: "todo" as const, id: 7, title: "Say hi" }, vouchesReceived: 0 };

describe("<StartHere />", () => {
    afterEach(cleanup);

    it("renders nothing while off", () => {
        renderWithIntl(<StartHere {...base} enabled={false} />);
        expect(screen.queryByTestId("start-here")).toBeNull();
        cleanup();
        renderWithIntl(<StartHere {...base} enabled={undefined} />);
        expect(screen.queryByTestId("start-here")).toBeNull();
    });

    it("shows three steps linking to missions and the profile", () => {
        renderWithIntl(<StartHere {...base} />);
        expect(screen.getByText("Say hi", { exact: false })).toBeInTheDocument();
        const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(hrefs).toEqual(["/missions", "/missions#mission-7", "/profile/123"]);
        expect(screen.getByTestId("start-here-vouch")).toHaveAttribute("data-done", "false");
    });

    it("marks the vouch and mission steps done when there is nothing left", () => {
        renderWithIntl(<StartHere {...base} mission={{ state: "done" }} vouchesReceived={2} />);
        expect(screen.getByTestId("start-here-vouch")).toHaveAttribute("data-done", "true");
        expect(screen.getByTestId("start-here-mission")).toHaveAttribute("data-done", "true");
    });

    it("does not count a sent-back mission as done and shows pending as waiting", () => {
        renderWithIntl(<StartHere {...base} mission={{ state: "todo", id: 9, title: "Redo it" }} />);
        expect(screen.getByTestId("start-here-mission")).toHaveAttribute("data-done", "false");
        cleanup();
        renderWithIntl(<StartHere {...base} mission={{ state: "pending" }} />);
        expect(screen.getByTestId("start-here-mission")).toHaveAttribute("data-done", "false");
        expect(screen.getByText(/waiting for review/i)).toBeInTheDocument();
    });
});
