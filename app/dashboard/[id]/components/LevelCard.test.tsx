import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { LevelCard, type LevelCardData } from "./LevelCard";

const card = (over: Partial<LevelCardData> = {}): LevelCardData => ({
    enabled: true,
    level: 3,
    title: "Line Cook",
    isMax: false,
    done: 1,
    total: 3,
    nextTitle: "Sous Chef",
    nextMissions: [
        { id: 2, title: "Connect X" },
        { id: 3, title: "Invite a friend" },
    ],
    awaitingReview: false,
    ...over,
});

describe("<LevelCard />", () => {
    afterEach(cleanup);

    it("renders nothing without data or while the setting is off", () => {
        renderWithIntl(<LevelCard card={undefined} />);
        expect(screen.queryByTestId("level-card")).toBeNull();
        cleanup();
        renderWithIntl(<LevelCard card={card({ enabled: false })} />);
        expect(screen.queryByTestId("level-card")).toBeNull();
    });

    it("shows level, title, progress and the next missions", () => {
        renderWithIntl(<LevelCard card={card()} />);
        expect(screen.getByText(/Level 3/)).toBeInTheDocument();
        expect(screen.getByText(/Line Cook/)).toBeInTheDocument();
        expect(screen.getByText("1 of 3 missions done")).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
        expect(screen.getByText("Connect X")).toBeInTheDocument();
        expect(screen.getByText("Invite a friend")).toBeInTheDocument();
        expect(screen.getByText(/Next level: Sous Chef/)).toBeInTheDocument();
    });

    it("says it is waiting for review when nothing is left to do", () => {
        renderWithIntl(<LevelCard card={card({ nextMissions: [], done: 2, awaitingReview: true })} />);
        expect(screen.getByText(/Waiting for review/)).toBeInTheDocument();
    });

    it("MAX level has no progress bar", () => {
        renderWithIntl(<LevelCard card={card({ isMax: true, level: 9 })} />);
        expect(screen.getByText("MAX level")).toBeInTheDocument();
        expect(screen.queryByRole("progressbar")).toBeNull();
    });
});
