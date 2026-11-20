import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { PfpComposer } from "./PfpComposer";

const base = {
  level: 2,
  allowedBaseKinds: ["mafia", "restyle"],
  access: { allowed: true, minLevel: 2, completed: 2 },
  bases: { static: "https://x/static.png", discord: "https://x/d.png", mafia: "https://x/m.png" },
  current: null,
  assets: [],
  outfitOverlay: false,
  restyle: { enabled: false, perUnlock: 2, dailyRemaining: 3, blocked: null, usedByOutfit: {} },
};

function mockState(over: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, ...over }) })));
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("PfpComposer", () => {
  it("offers only the mafia portrait: no upload, Discord or Current base", async () => {
    mockState({});
    render(<PfpComposer memberId="42" />);
    await waitFor(() => expect(screen.getByText("Mafia portrait")).toBeTruthy());
    expect(screen.queryByText("Upload")).toBeNull();
    expect(screen.queryByText("Discord")).toBeNull();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByTestId("pfp-no-portrait")).toBeNull();
  });

  it("lets a member without a portrait draw one from their own mafia name, then reloads", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    let drawn = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url === "/api/mafia-portrait") { drawn = true; return { ok: true, status: 200, json: async () => ({ url: "https://x/m.png" }) }; }
      return { ok: true, json: async () => ({ ...base, memberName: "Tony Soprano", bases: { ...base.bases, mafia: drawn ? "https://x/m.png" : null } }) };
    }));
    render(<PfpComposer memberId="42" />);
    const box = await screen.findByTestId("pfp-no-portrait");
    fireEvent.click(box.querySelector("button")!);
    await waitFor(() => expect(screen.queryByTestId("pfp-no-portrait")).toBeNull());
    const post = calls.find(([u]) => u === "/api/mafia-portrait")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ name: "Tony Soprano", variant: 0 });
  });

  it("shows the locked state with progress and a missions link below the level", async () => {
    mockState({ access: { allowed: false, minLevel: 2, completed: 1 } });
    render(<PfpComposer memberId="42" />);
    await screen.findByTestId("pfp-locked");
    expect(screen.getByText("Reach level 2 to make your PFP")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("Go to missions").getAttribute("href")).toBe("/missions");
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("lists what is left with links, capped, and the review line by access", async () => {
    const remaining = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `Mission ${i + 1}`, level: 2, ...(i === 0 ? { href: "/handbook/x" } : {}) }));
    mockState({ access: { allowed: false, minLevel: 2, completed: 1 }, remaining, review: { href: "/review/abc", canVote: true } });
    render(<PfpComposer memberId="42" />);
    const box = await screen.findByTestId("pfp-whats-left");
    expect(screen.getByText("Mission 1").getAttribute("href")).toBe("/handbook/x");
    expect(screen.getByText("Mission 2").getAttribute("href")).toBe("/missions");
    expect(screen.queryByText("Mission 11")).toBeNull();
    expect(box.textContent).toContain("and 2 more");
    expect(screen.getByText("help pick the dough-ball look for new members").getAttribute("href")).toBe("/review/abc");
  });

  it("says to reach level 2 when the review is not open to the member, and hides the line when unset", async () => {
    mockState({ access: { allowed: false, minLevel: 2, completed: 0 }, remaining: [], review: { href: "/review/abc", canVote: false } });
    const { unmount } = render(<PfpComposer memberId="42" />);
    await screen.findByText("Once you reach level 2 you can vote on the dough-ball looks too.");
    expect(screen.queryByTestId("pfp-whats-left")).toBeNull();
    unmount();
    mockState({ access: { allowed: false, minLevel: 2, completed: 0 }, review: null });
    render(<PfpComposer memberId="42" />);
    await screen.findByTestId("pfp-locked");
    expect(screen.queryByTestId("pfp-locked-review")).toBeNull();
  });

  it("keeps showing the saved PFP, with Remove, in the locked state", async () => {
    mockState({
      access: { allowed: false, minLevel: 2, completed: 0 },
      current: { baseKind: "mafia", baseUrl: "https://x/m.png", composedUrl: "https://x/saved.webp", layers: [], original: null },
    });
    render(<PfpComposer memberId="42" />);
    const box = await screen.findByTestId("pfp-locked-saved");
    expect(box.querySelector("img")?.getAttribute("src")).toBe("https://x/saved.webp");
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("brings legacy bases back when the setting allows them", async () => {
    mockState({ allowedBaseKinds: ["mafia", "restyle", "upload", "discord"] });
    render(<PfpComposer memberId="42" />);
    await screen.findByText("Upload");
    expect(screen.getByText("Discord")).toBeTruthy();
  });
});
