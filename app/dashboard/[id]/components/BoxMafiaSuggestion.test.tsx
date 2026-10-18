import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";
import { BoxMafiaSuggestion, BOX_MAFIA_DISMISS_KEY, type BoxMafiaSummary } from "./BoxMafiaSuggestion";

const URL_ = "https://opensea.io/collection/rare-pizzas-box";
function make(status: BoxMafiaSummary["status"], purchaseUrl = URL_): BoxMafiaSummary {
    return { status, purchaseUrl, dailyPep: 42 };
}

describe("<BoxMafiaSuggestion />", () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(cleanup);

    it("renders for missing", () => {
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing")} />);
        expect(screen.getByText("Join the Box Mafia")).toBeInTheDocument();
        expect(screen.getByText(/42 PEP a day/)).toBeInTheDocument();
    });

    it.each(["has_role", "unknown"] as const)("does not render for %s", (status) => {
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make(status)} />);
        expect(screen.queryByTestId("box-mafia-suggestion")).toBeNull();
    });

    it("does not render without data or without a purchase URL", () => {
        renderWithIntl(<BoxMafiaSuggestion boxMafia={undefined} />);
        expect(screen.queryByTestId("box-mafia-suggestion")).toBeNull();
        cleanup();
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing", "")} />);
        expect(screen.queryByTestId("box-mafia-suggestion")).toBeNull();
    });

    it("CTA opens the purchase URL in a new tab", () => {
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing")} />);
        const a = screen.getByRole("link", { name: /Get a box/ });
        expect(a.getAttribute("href")).toBe(URL_);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("Not now hides the card and stores a snooze", () => {
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing")} />);
        fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
        expect(screen.queryByTestId("box-mafia-suggestion")).toBeNull();
        const until = Number(window.localStorage.getItem(BOX_MAFIA_DISMISS_KEY));
        expect(until).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    });

    it("a future snooze suppresses the card on mount; an expired one does not", () => {
        window.localStorage.setItem(BOX_MAFIA_DISMISS_KEY, String(Date.now() + 60_000));
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing")} />);
        expect(screen.queryByTestId("box-mafia-suggestion")).toBeNull();
        cleanup();
        window.localStorage.setItem(BOX_MAFIA_DISMISS_KEY, String(Date.now() - 60_000));
        renderWithIntl(<BoxMafiaSuggestion boxMafia={make("missing")} />);
        expect(screen.getByTestId("box-mafia-suggestion")).toBeInTheDocument();
    });
});
