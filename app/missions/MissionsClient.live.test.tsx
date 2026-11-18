import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
const live = vi.hoisted(() => ({ onChange: null as null | ((c: { mine: boolean; queue: boolean }) => void), queue: false }));
const session = vi.hoisted(() => ({ canReview: false }));
const panelProps = vi.hoisted(() => ({ keys: [] as number[] }));

vi.mock("@/app/ui/shared/Toast", () => ({ useToast: () => toast }));
vi.mock("@/app/lib/hooks/use-session", () => ({
  useSession: () => ({ data: { canReviewMissions: session.canReview } }),
}));
vi.mock("@/app/lib/hooks/use-live-version", () => ({
  useLiveVersion: (o: { onChange: typeof live.onChange; queue?: boolean }) => {
    live.onChange = o.onChange;
    live.queue = !!o.queue;
  },
}));
vi.mock("@/app/ui/shared/TermExplanation", () => ({ TermExplanation: () => null }));
vi.mock("../ui/missions/MissionCard", () => ({ MissionCard: () => null }));
vi.mock("../ui/missions/MissionReviewPanel", () => ({
  MissionReviewPanel: ({ refreshKey }: { refreshKey: number }) => {
    panelProps.keys.push(refreshKey);
    return null;
  },
}));
vi.mock("../ui/missions/MissionCompleteCelebration", () => ({ MissionCompleteCelebration: () => null }));
vi.mock("../ui/missions/LevelUpModal", () => ({ LevelUpModal: () => null }));
vi.mock("../ui/missions/GuideLink", () => ({ HowLevelsWorkLink: () => null }));
vi.mock("../ui/missions/VouchPromptCard", () => ({ VouchPromptCard: () => null }));

import MissionsClient from "./MissionsClient";

const snapshot = (status: string) => ({
  levels: [
    {
      level: 1,
      title: "Trainee",
      reward: 100,
      missions: [{ id: 7, index: 1, title: "Join Discord", description: null, progress: { status, submittedAt: "x" } }],
    },
  ],
  currentLevel: 1,
  levelTitle: "Trainee",
  isAuthenticated: true,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  panelProps.keys = [];
  session.canReview = false;
});

describe("live updates on /missions", () => {
  it("refetches and toasts an approval when the member's version changes", async () => {
    const f = vi.fn(async (url: string) =>
      url === "/api/missions" ? new Response(JSON.stringify(snapshot("APPROVED"))) : new Response("{}", { status: 404 }),
    );
    vi.stubGlobal("fetch", f);
    render(<MissionsClient initial={snapshot("PENDING") as never} />);
    await act(async () => live.onChange?.({ mine: true, queue: false }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mission approved: Join Discord"));
    expect(f.mock.calls.filter(([u]) => u === "/api/missions")).toHaveLength(1);
  });

  it("does not refetch or toast for an unrelated change flag", async () => {
    const f = vi.fn(async (_url: string) => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", f);
    render(<MissionsClient initial={snapshot("PENDING") as never} />);
    await act(async () => live.onChange?.({ mine: false, queue: false }));
    expect(f.mock.calls.filter(([u]) => u === "/api/missions")).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts reviewers about a new submission and refreshes the queue", async () => {
    session.canReview = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<MissionsClient initial={snapshot("PENDING") as never} />);
    expect(live.queue).toBe(true);
    await act(async () => live.onChange?.({ mine: false, queue: true }));
    expect(toast.info).toHaveBeenCalledWith("New mission submitted for review");
    expect(panelProps.keys.at(-1)).toBe(1);
  });

  it("ignores queue changes for non-reviewers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    render(<MissionsClient initial={snapshot("PENDING") as never} />);
    await act(async () => live.onChange?.({ mine: false, queue: true }));
    expect(toast.info).not.toHaveBeenCalled();
  });
});
