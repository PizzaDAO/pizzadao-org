// jalapeno-82565 — crew bounty board on /crew/[crewId].
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CrewBounties, openCrewBounties, groupCrewBounties, type CrewBounty } from "./CrewBounties";

const BOUNTIES: CrewBounty[] = [
  { id: 1, description: "Small ops task", link: null, reward: 50, status: "OPEN", crewId: "ops", createdBy: "poster" },
  { id: 2, description: "Claimed ops task", link: null, reward: 500, status: "CLAIMED", crewId: "ops", createdBy: "poster", claimedBy: "claimer" },
  { id: 3, description: "Big ops task", link: "https://example.com", reward: 300, status: "OPEN", crewId: "ops", createdBy: "poster" },
  { id: 4, description: "Tech task", link: null, reward: 999, status: "OPEN", crewId: "tech", createdBy: "poster" },
  {
    id: 5,
    description: "Reviewable task",
    link: null,
    reward: 120,
    status: "SUBMITTED",
    crewId: "ops",
    createdBy: "poster",
    claimedBy: "claimer",
    submissionNote: "All done, see PR",
    submissionLink: "https://example.com/pr/5",
  },
  {
    id: 6,
    description: "Sent back task",
    link: null,
    reward: 10,
    status: "CLAIMED",
    crewId: "ops",
    createdBy: "poster",
    claimedBy: "claimer",
    reviewNote: "Please add tests",
  },
];

function mockApi(viewer?: { discordId: string; canManageCrew: boolean }, extra?: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/bounties?")) {
      return { ok: true, json: async () => ({ bounties: BOUNTIES, ...(viewer ? { viewer } : {}) }) };
    }
    if (url === "/api/economy/balance") return { ok: true, json: async () => ({ balance: 777 }) };
    return { ok: true, json: async () => ({ success: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const row = (id: number) => screen.getByTestId(`crew-bounty-${id}`);
const buttons = (id: number) => within(row(id)).queryAllByRole("button").map((b) => b.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openCrewBounties / groupCrewBounties", () => {
  it("openCrewBounties keeps only this crew's OPEN bounties, highest reward first", () => {
    expect(openCrewBounties(BOUNTIES, "ops").map((b) => b.id)).toEqual([3, 1]);
  });

  it("groups this crew's bounties into open, in progress and awaiting review", () => {
    const g = groupCrewBounties(BOUNTIES, "ops");
    expect(g.open.map((b) => b.id)).toEqual([3, 1]);
    expect(g.inProgress.map((b) => b.id)).toEqual([2, 6]);
    expect(g.review.map((b) => b.id)).toEqual([5]);
  });
});

describe("<CrewBounties /> signed out", () => {
  it("lists the sections with no form and no action buttons, and offers login", async () => {
    const fetchMock = mockApi();
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);

    expect(await screen.findByText("Big ops task")).toBeInTheDocument();
    expect(screen.getByText("Claimed ops task")).toBeInTheDocument();
    expect(screen.getByText("Reviewable task")).toBeInTheDocument();
    expect(screen.queryByText("Tech task")).not.toBeInTheDocument();
    expect(screen.getByText("Crew Bounties (5)")).toBeInTheDocument();
    expect(screen.getByText("Open (2)")).toBeInTheDocument();
    expect(screen.getByText("In progress (2)")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review (1)")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login?returnTo=%2Fcrew%2Fops");
    expect(fetchMock).toHaveBeenCalledWith("/api/bounties?crewId=ops", { cache: "no-store" });
    expect(document.getElementById("bounties")).not.toBeNull();
  });

  it("renders nothing for visitors when there are no bounties", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bounties: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" hideWhenEmpty />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty state otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bounties: [] }) }));
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    expect(await screen.findByText("No open bounties for this crew yet.")).toBeInTheDocument();
  });
});

describe("<CrewBounties /> per-role actions", () => {
  it("a plain member can claim open bounties but not approve", async () => {
    mockApi({ discordId: "member", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(buttons(1)).toEqual(["Claim"]);
    expect(buttons(5)).toEqual([]);
    expect(buttons(2)).toEqual([]);
  });

  it("the claimer can submit work and give up, never approve", async () => {
    mockApi({ discordId: "claimer", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(buttons(2)).toEqual(["Submit work", "Give up"]);
    expect(buttons(5)).toEqual(["Give up"]); // submitted: wait for review
    expect(buttons(1)).toEqual(["Claim"]);
  });

  it("the poster can approve, send back or cancel; not claim their own", async () => {
    mockApi({ discordId: "poster", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(buttons(1)).toEqual(["Cancel bounty"]);
    expect(buttons(5)).toEqual(["Approve", "Send back", "Cancel bounty"]);
  });

  it("a crew lead who is not the poster gets Approve / Send back / Cancel", async () => {
    mockApi({ discordId: "lead", canManageCrew: true });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(buttons(5)).toEqual(["Approve", "Send back", "Cancel bounty"]);
    expect(buttons(1)).toEqual(["Claim", "Cancel bounty"]);
  });

  it("a lead who is also the claimer gets no approve button", async () => {
    mockApi({ discordId: "claimer", canManageCrew: true });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(buttons(5)).toEqual(["Give up"]);
  });

  it("shows the submission to reviewers and the rejection note to the claimer", async () => {
    mockApi({ discordId: "claimer", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    expect(within(row(5)).getByText("All done, see PR")).toBeInTheDocument();
    expect(within(row(5)).getByRole("link", { name: "View proof" })).toHaveAttribute("href", "https://example.com/pr/5");
    expect(within(row(6)).getByTestId("crew-bounty-review-note")).toHaveTextContent("Sent back: Please add tests");
  });
});

describe("<CrewBounties /> writes", () => {
  it("the post form sends this crew's id and the reward, then reloads", async () => {
    const fetchMock = mockApi({ discordId: "member", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");

    fireEvent.click(screen.getByRole("button", { name: /Post a bounty for Ops/ }));
    expect(await screen.findByText("Your balance: 777 PEP")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What needs doing?"), { target: { value: "Paint the wall" } });
    fireEvent.change(screen.getByLabelText("Reward ($PEP)"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Post bounty" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => u === "/api/bounties");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ description: "Paint the wall", reward: 25, crewId: "ops" });
    });
  });

  it("submitting work posts the note and link", async () => {
    const fetchMock = mockApi({ discordId: "claimer", canManageCrew: false });
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");

    fireEvent.click(within(row(2)).getByRole("button", { name: "Submit work" }));
    fireEvent.change(within(row(2)).getByLabelText("What did you do?"), { target: { value: "Did it" } });
    fireEvent.change(within(row(2)).getByLabelText("Proof link (optional, https)"), { target: { value: "https://x.test/p" } });
    fireEvent.click(within(row(2)).getByRole("button", { name: "Send for review" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => u === "/api/bounties/submit");
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ bountyId: 2, note: "Did it", link: "https://x.test/p" });
    });
  });

  it("sending back posts the reviewer's note; approve asks for confirmation first", async () => {
    const fetchMock = mockApi({ discordId: "lead", canManageCrew: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");

    fireEvent.click(within(row(5)).getByRole("button", { name: "Send back" }));
    fireEvent.change(within(row(5)).getByLabelText("Why is it being sent back?"), { target: { value: "Add tests" } });
    fireEvent.click(within(row(5)).getByRole("button", { name: "Send back with note" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => u === "/api/bounties/reject");
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ bountyId: 5, note: "Add tests" });
    });

    fireEvent.click(within(row(5)).getByRole("button", { name: "Approve" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/bounties/complete")).toBe(false); // declined

    fireEvent.click(within(row(5)).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/bounties/complete")).toBe(true));
  });

  it("shows the server's error on a failed action", async () => {
    mockApi({ discordId: "member", canManageCrew: false }, (url) =>
      url === "/api/bounties/claim" ? { ok: false, json: async () => ({ error: "Bounty is not available" }) } : undefined,
    );
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />);
    await screen.findByText("Big ops task");
    fireEvent.click(within(row(1)).getByRole("button", { name: "Claim" }));
    expect(await within(row(1)).findByRole("alert")).toHaveTextContent("Bounty is not available");
  });
});

describe("<CrewBounties /> i18n", () => {
  it("renders Spanish and French strings", async () => {
    mockApi({ discordId: "claimer", canManageCrew: false });
    const { unmount } = renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />, { locale: "es" });
    expect(await screen.findByText("Recompensas del crew (5)")).toBeInTheDocument();
    expect(within(row(2)).getByRole("button", { name: "Enviar trabajo" })).toBeInTheDocument();
    unmount();
    renderWithIntl(<CrewBounties crewId="ops" crewLabel="Ops" />, { locale: "fr" });
    expect(await screen.findByText("Primes du crew (5)")).toBeInTheDocument();
    expect(within(row(2)).getByRole("button", { name: "Soumettre le travail" })).toBeInTheDocument();
  });
});
