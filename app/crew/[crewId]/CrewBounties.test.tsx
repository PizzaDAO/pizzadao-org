// jalapeno-82565 — crew bounties section on /crew/[crewId].
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CrewBounties, openCrewBounties, type CrewBounty } from "./CrewBounties";

const BOUNTIES: CrewBounty[] = [
  { id: 1, description: "Small ops task", link: null, reward: 50, status: "OPEN", crewId: "ops" },
  { id: 2, description: "Claimed ops task", link: null, reward: 500, status: "CLAIMED", crewId: "ops" },
  { id: 3, description: "Big ops task", link: "https://example.com", reward: 300, status: "OPEN", crewId: "ops" },
  { id: 4, description: "Tech task", link: null, reward: 999, status: "OPEN", crewId: "tech" },
];


afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openCrewBounties", () => {
  it("keeps only this crew's OPEN bounties, highest reward first", () => {
    expect(openCrewBounties(BOUNTIES, "ops").map((b) => b.id)).toEqual([3, 1]);
  });
});

describe("<CrewBounties />", () => {
  it("fetches the crew's bounties and lists the open ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bounties: BOUNTIES }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CrewBounties crewId="ops" crewLabel="Ops" />);

    expect(await screen.findByText("Big ops task")).toBeInTheDocument();
    expect(screen.getByText("Small ops task")).toBeInTheDocument();
    expect(screen.queryByText("Claimed ops task")).not.toBeInTheDocument();
    expect(screen.queryByText("Tech task")).not.toBeInTheDocument();
    expect(screen.getByText("Crew Bounties (2)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/bounties?crewId=ops");
  });

  it("shows an empty state for members", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bounties: [] }) }));
    render(<CrewBounties crewId="ops" crewLabel="Ops" />);
    expect(await screen.findByText("No open bounties for this crew yet.")).toBeInTheDocument();
  });

  it("renders nothing for visitors when there are no bounties", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bounties: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CrewBounties crewId="ops" crewLabel="Ops" hideWhenEmpty />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
