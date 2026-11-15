import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { LaneCard } from "./LaneCard";

const pinned = { slug: "host", tag: "Host", title: "Throw a pizza party", done: 3, total: 7, href: "/lanes/host" };

describe("<LaneCard />", () => {
    afterEach(cleanup);

    it("renders nothing without data or while the setting is off", () => {
        renderWithIntl(<LaneCard lane={undefined} />);
        expect(screen.queryByTestId("lane-card")).toBeNull();
        cleanup();
        renderWithIntl(<LaneCard lane={{ enabled: false, pinned }} />);
        expect(screen.queryByTestId("lane-card")).toBeNull();
    });

    it("shows the pinned lane, its progress and a Continue link to the guide", () => {
        renderWithIntl(<LaneCard lane={{ enabled: true, pinned }} />);
        expect(screen.getByText(/Throw a pizza party/)).toBeInTheDocument();
        expect(screen.getByText("3 of 7 steps")).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
        expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/lanes/host");
    });

    it("prompts to pick a lane when none is pinned", () => {
        renderWithIntl(<LaneCard lane={{ enabled: true, pinned: null }} />);
        expect(screen.getByRole("link", { name: "Find your lane" })).toHaveAttribute("href", "/community#ways-in");
        expect(screen.queryByRole("progressbar")).toBeNull();
    });
});
