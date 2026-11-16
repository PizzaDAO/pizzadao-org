import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl as render } from "@/app/lib/i18n/test-utils";
import { DiscordActivityBlock, DiscordActivityLine } from "../DiscordActivityBlock";

const activity = {
    messages: 757,
    since: "2021-03-01T00:00:00.000Z",
    lastActive: "2026-05-01T00:00:00.000Z",
    activeMonths: 31,
    topChannels: ["general", "pizza"],
};

describe("DiscordActivityBlock", () => {
    it("shows messages, month-precision dates, active months and channels", () => {
        render(<DiscordActivityBlock activity={activity} />);
        expect(screen.getByTestId("discord-activity-messages").textContent).toBe("757 messages");
        const text = screen.getByTestId("discord-activity").textContent ?? "";
        expect(text).toContain("March 2021");
        expect(text).toContain("May 2026");
        expect(text).toContain("31 months");
        expect(text).toContain("#general, #pizza");
    });
    it("is compact for thousands of messages", () => {
        render(<DiscordActivityBlock activity={{ ...activity, messages: 12431 }} />);
        expect(screen.getByTestId("discord-activity-messages").textContent).toBe("12.4K messages");
    });
    it("renders nothing without activity", () => {
        const { container } = render(<DiscordActivityBlock activity={null} />);
        expect(container.querySelector("[data-testid=discord-activity]")).toBeNull();
        const line = render(<DiscordActivityLine activity={{ ...activity, messages: 0 }} />);
        expect(line.container.querySelector("[data-testid=member-card-discord]")).toBeNull();
    });
    it("hover card line is one compact line", () => {
        render(<DiscordActivityLine activity={activity} />);
        const t = screen.getByTestId("member-card-discord").textContent ?? "";
        expect(t).toContain("757 messages");
        expect(t).toContain("since March 2021");
        expect(t).toContain("last active May 2026");
    });
});
