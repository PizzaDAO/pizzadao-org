import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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

  it("guides a member without a portrait to generate one", async () => {
    mockState({ bases: { ...base.bases, mafia: null } });
    render(<PfpComposer memberId="42" />);
    const box = await screen.findByTestId("pfp-no-portrait");
    expect(box.querySelector("a")?.getAttribute("href")).toBe("/get-your-mafia-name");
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

  it("brings legacy bases back when the setting allows them", async () => {
    mockState({ allowedBaseKinds: ["mafia", "restyle", "upload", "discord"] });
    render(<PfpComposer memberId="42" />);
    await screen.findByText("Upload");
    expect(screen.getByText("Discord")).toBeTruthy();
  });
});
