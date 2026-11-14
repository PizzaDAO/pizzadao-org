// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  switches: { publicEnabled: false, introText: "", contributeUrl: "" },
  getPublicCatalog: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/lib/features/service", () => ({
  loadSwitches: vi.fn(async () => mocks.switches),
  getPublicCatalog: mocks.getPublicCatalog,
}));
vi.mock("./FeaturesView", () => ({ default: () => null }));

import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.switches.publicEnabled = false;
});

describe("/features", () => {
  it("is a 404 while the page switch is off, and reads no rows", async () => {
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getPublicCatalog).not.toHaveBeenCalled();
  });

  it("renders the catalog once the switch is on", async () => {
    mocks.switches.publicEnabled = true;
    mocks.getPublicCatalog.mockResolvedValue({ catalog: { apps: [], entries: [], generatedAt: "", githubOk: true }, switches: mocks.switches });
    const el = (await Page()) as { props: { catalog: unknown } };
    expect(el.props.catalog).toBeDefined();
  });

  it("is a 404 when the catalog cannot be read", async () => {
    mocks.switches.publicEnabled = true;
    mocks.getPublicCatalog.mockRejectedValue(new Error("db down"));
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
