import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
vi.mock("@/app/ui/shared/Toast", () => ({ useToast: () => toast }));
vi.mock("@/app/lib/hooks/use-session", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/app/ui/shared/TermExplanation", () => ({ TermExplanation: () => null }));
vi.mock("../ui/missions/MissionCard", () => ({ MissionCard: () => null }));
vi.mock("../ui/missions/MissionReviewPanel", () => ({ MissionReviewPanel: () => null }));
vi.mock("../ui/missions/MissionCompleteCelebration", () => ({ MissionCompleteCelebration: () => null }));
vi.mock("../ui/missions/LevelUpModal", () => ({ LevelUpModal: () => null }));
vi.mock("../ui/missions/GuideLink", () => ({ HowLevelsWorkLink: () => null }));
vi.mock("../ui/missions/VouchPromptCard", () => ({ VouchPromptCard: () => null }));

import MissionsClient from "./MissionsClient";

const initial = {
  levels: [{ level: 1, title: "Pizza Trainee", reward: 100, missions: [] }],
  currentLevel: 1,
  levelTitle: "Pizza Trainee",
  isAuthenticated: true,
  verifiersEnabled: true,
};

function stubFetch(missionsOk: boolean) {
  const f = vi.fn(async (url: string) => {
    if (url === "/api/missions/check") {
      return new Response(
        JSON.stringify({ enabled: true, approved: [], held: [], reopened: [], levelsPaid: [], missions: [] }),
        { status: 200 },
      );
    }
    if (url === "/api/missions") {
      return missionsOk
        ? new Response(JSON.stringify(initial), { status: 200 })
        : new Response("{}", { status: 500 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("<MissionsClient /> error handling", () => {
  it("keeps the loaded page and toasts when a background refresh fails", async () => {
    stubFetch(false);
    render(<MissionsClient initial={initial} />);
    fireEvent.click(await screen.findByTestId("check-progress"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("refresh")),
    );
    expect(screen.queryByText("The file went missing.")).toBeNull();
    expect(screen.getByTestId("check-progress")).toBeTruthy();
  });

  it("shows the full error screen only when there is no data", async () => {
    stubFetch(false);
    render(<MissionsClient initial={null} />);
    expect(await screen.findByText("The file went missing.")).toBeTruthy();
  });
});

describe("<MissionsClient /> level header", () => {
  it("shows the completed level and the next goal", async () => {
    stubFetch(true);
    const data = {
      ...initial,
      levels: [
        { level: 7, title: "Made Mafia", reward: 1, missions: [] },
        { level: 8, title: "Don of Dons", reward: 1, missions: [] },
      ],
      currentLevel: 8,
      levelTitle: "Don of Dons",
    };
    render(<MissionsClient initial={data} />);
    expect((await screen.findAllByText("Made Mafia")).length).toBeGreaterThan(0);
    expect(screen.getByText("§ Level Completed")).toBeTruthy();
    expect(screen.getByText(/Next: Level 8\s*· Don of Dons/)).toBeTruthy();
  });

  it("starts at Lv. 0 with level 1 as the next goal", async () => {
    stubFetch(true);
    render(<MissionsClient initial={initial} />);
    expect(await screen.findByText(/Next: Level 1\s*· Pizza Trainee/)).toBeTruthy();
  });
});
