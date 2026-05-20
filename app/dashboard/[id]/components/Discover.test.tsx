// app/dashboard/[id]/components/Discover.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Render next/link as a plain anchor so href shows up in the DOM.
vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

import {
    Discover,
    type DiscoverArticle,
    type DiscoverBounty,
    type DiscoverCall,
    type DiscoverJob,
} from "./Discover";

const BOUNTIES: DiscoverBounty[] = [
    { id: 1, description: "Write a blog post", reward: 420, status: "OPEN" },
    { id: 2, description: "Design a flyer", reward: 69, status: "CLAIMED" },
    { id: 3, description: "Translate FAQ to Italian", reward: 1000, status: "OPEN" },
];

const JOBS: DiscoverJob[] = [
    { id: 10, description: "Daily check-in", crew: "Comms" },
    { id: 11, description: "Share an article", crew: "Comms", completed: true },
];

const ARTICLES: DiscoverArticle[] = [
    {
        id: 100,
        slug: "the-slice",
        title: "The Slice That Started Everything",
        authorName: "Turkey Sausage",
        publishedAt: "2026-05-01T00:00:00.000Z",
    },
];

const CALLS: DiscoverCall[] = [
    { crewId: "ops", crewLabel: "Ops", date: "2026-05-20" },
    { crewId: "tech", crewLabel: "Tech", date: "2026-05-21" },
];

describe("<Discover />", () => {
    it("defaults to the Bounties tab and shows top 3 bounty previews", () => {
        render(
            <Discover
                bounties={BOUNTIES}
                jobs={JOBS}
                articles={ARTICLES}
                calls={CALLS}
            />,
        );
        const root = screen.getByTestId("discover");
        expect(root).toHaveAttribute("data-active", "bounties");
        expect(screen.getByText("Write a blog post")).toBeInTheDocument();
        expect(screen.getByText("Design a flyer")).toBeInTheDocument();
        expect(screen.getByText("Translate FAQ to Italian")).toBeInTheDocument();
        // Reward formatting
        expect(screen.getByText("420 PEP")).toBeInTheDocument();
        expect(screen.getByText("1,000 PEP")).toBeInTheDocument();
        // Status pills
        expect(screen.getAllByText("Open").length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText("Claimed")).toBeInTheDocument();
    });

    it("switches to the Jobs tab and renders job previews", async () => {
        render(<Discover bounties={BOUNTIES} jobs={JOBS} articles={ARTICLES} calls={CALLS} />);
        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Jobs/ }));
        });
        const root = screen.getByTestId("discover");
        expect(root).toHaveAttribute("data-active", "jobs");
        expect(screen.getByText("Daily check-in")).toBeInTheDocument();
        expect(screen.getByText("Share an article")).toBeInTheDocument();
        // Crew label shown
        expect(screen.getAllByText("Comms").length).toBeGreaterThan(0);
        // Done pill rendered for completed job
        expect(screen.getByText("Done")).toBeInTheDocument();
    });

    it("switches to the Articles tab and links to the article slug", async () => {
        render(<Discover bounties={BOUNTIES} jobs={JOBS} articles={ARTICLES} calls={CALLS} />);
        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Articles/ }));
        });
        const root = screen.getByTestId("discover");
        expect(root).toHaveAttribute("data-active", "articles");
        const link = screen.getByRole("link", { name: /Article:.*The Slice/i });
        expect(link).toHaveAttribute("href", "/articles/the-slice");
        expect(screen.getByText(/by Turkey Sausage/)).toBeInTheDocument();
    });

    it("switches to the Calls tab and renders crew + date", async () => {
        render(<Discover bounties={BOUNTIES} jobs={JOBS} articles={ARTICLES} calls={CALLS} />);
        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
        });
        const root = screen.getByTestId("discover");
        expect(root).toHaveAttribute("data-active", "calls");
        expect(screen.getByText("Ops")).toBeInTheDocument();
        expect(screen.getByText("Tech")).toBeInTheDocument();
    });

    it("shows an empty state when a tab has zero items", async () => {
        render(<Discover bounties={[]} jobs={[]} articles={[]} calls={[]} />);
        // Bounties (default) empty state
        expect(
            screen.getByText(/No open bounties right now/i),
        ).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Jobs/ }));
        });
        expect(screen.getByText(/No jobs available today/i)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Articles/ }));
        });
        expect(screen.getByText(/No published articles yet/i)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
        });
        expect(screen.getByText(/No upcoming calls this week/i)).toBeInTheDocument();
    });

    it("renders a 'View all' link that targets the active tab's listing page", async () => {
        render(<Discover bounties={BOUNTIES} jobs={JOBS} articles={ARTICLES} calls={CALLS} />);
        // Default tab: bounties → /pep
        let viewAll = screen.getByRole("link", { name: /View all/ });
        expect(viewAll).toHaveAttribute("href", "/pep");

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Articles/ }));
        });
        viewAll = screen.getByRole("link", { name: /View all/ });
        expect(viewAll).toHaveAttribute("href", "/articles");

        await act(async () => {
            fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
        });
        viewAll = screen.getByRole("link", { name: /View all/ });
        expect(viewAll).toHaveAttribute("href", "/calls");
    });

    it("caps preview items at 3 per tab even if more are passed", () => {
        const many: DiscoverBounty[] = Array.from({ length: 7 }, (_, i) => ({
            id: i + 1,
            description: `Bounty ${i + 1}`,
            reward: 100,
            status: "OPEN" as const,
        }));
        render(<Discover bounties={many} />);
        expect(screen.getByText("Bounty 1")).toBeInTheDocument();
        expect(screen.getByText("Bounty 2")).toBeInTheDocument();
        expect(screen.getByText("Bounty 3")).toBeInTheDocument();
        expect(screen.queryByText("Bounty 4")).not.toBeInTheDocument();
    });
});
