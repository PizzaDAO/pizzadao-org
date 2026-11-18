// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: false, list: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: vi.fn(async () => mocks.enabled) }));
vi.mock("@/app/lib/settings", () => ({ getSetting: vi.fn(async () => "") }));
vi.mock("@/app/lib/education-sessions/public", () => ({ listPublicSessions: mocks.list }));
vi.mock("@/app/(marketing)/_site/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/app/(marketing)/_site/components/Footer", () => ({ default: () => null }));
vi.mock("./LocalTime", () => ({ default: () => null }));
vi.mock("./ManageLink", () => ({ default: () => null }));

import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  mocks.list.mockResolvedValue({ upcoming: [], past: [] });
});

describe("/learn", () => {
  it("is a 404 while the listing switch is off, and reads no sessions", async () => {
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("renders when the switch is on", async () => {
    mocks.enabled = true;
    await expect(Page()).resolves.toBeTruthy();
  });
});
