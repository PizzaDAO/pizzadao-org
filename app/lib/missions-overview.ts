/**
 * Missions overview for the /missions page: every active mission grouped by
 * level, plus the viewer's progress and current level when signed in.
 *
 * Same shape and rules as GET /api/missions (including the shared in-memory
 * cache of the anonymous mission list), so the server-rendered page and the
 * client refetch after a submission agree.
 */

import { getMissionsByLevel, getUserMissionProgress, getCurrentLevel, getLevelTitle } from "@/app/lib/missions";
import { getCachedMissionsList, setCachedMissionsList } from "@/app/lib/mission-cache";
import { getVerifier } from "@/app/lib/mission-verify/verifiers";

/** Whether a mission's verifier can approve it automatically (not "manual", not a stub that never passes). */
function isAutoChecked(key: string | null | undefined): boolean {
  return getVerifier(key)?.mode === "auto" && key !== "referral";
}

export type MissionProgress = {
  status: string;
  submittedAt: string;
  reviewNote?: string | null;
  /** Set while an auto-verified completion awaits a reviewer's release (D9). */
  holdReason?: string | null;
};

export type MissionsOverview = {
  levels: {
    level: number;
    title: string | null;
    reward: number;
    missions: {
      id: number;
      index: number;
      title: string;
      description: string | null;
      /** Checked automatically (an automatic verifier is configured). */
      autoChecked: boolean;
      /** What the submit form asks for: NONE / URL / DISCORD_MESSAGE / UPLOAD. */
      proofKind: string;
      progress: MissionProgress | null;
    }[];
  }[];
  currentLevel: number;
  levelTitle: string | null;
  isAuthenticated: boolean;
};

export async function getMissionsOverview(discordId: string | null | undefined): Promise<MissionsOverview> {
  const progressMap: Record<number, MissionProgress> = {};
  let currentLevel = 1;
  let levelTitle: string | null = null;

  if (discordId) {
    const progress = await getUserMissionProgress(discordId);
    currentLevel = await getCurrentLevel(discordId);
    levelTitle = await getLevelTitle(currentLevel);
    for (const p of progress) {
      progressMap[p.missionId] = {
        status: p.status,
        submittedAt: p.submittedAt.toISOString(),
        reviewNote: p.reviewNote,
        holdReason: p.holdReason ?? null,
      };
    }
  }

  let levels: MissionsOverview["levels"] | null = !discordId ? getCachedMissionsList() : null;
  if (!levels) {
    const missionsByLevel = await getMissionsByLevel();
    levels = Object.entries(missionsByLevel).map(([levelNum, missions]) => ({
      level: parseInt(levelNum),
      title: missions[0]?.levelTitle || null,
      reward: missions[0]?.reward || 0,
      missions: missions.map((m) => ({
        id: m.id,
        index: m.index,
        title: m.title,
        description: m.description,
        autoChecked: isAutoChecked(m.verifierKey),
        proofKind: m.proofKind ?? "NONE",
        progress: progressMap[m.id] || null,
      })),
    }));
    if (!discordId) setCachedMissionsList(levels);
  }

  return { levels, currentLevel, levelTitle, isAuthenticated: !!discordId };
}
