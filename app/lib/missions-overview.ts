/**
 * Missions overview for the /missions page: every active mission grouped by
 * level, plus the viewer's progress and current level when signed in.
 *
 * Same shape and rules as GET /api/missions (including the shared in-memory
 * cache of the anonymous mission list), so the server-rendered page and the
 * client refetch after a submission agree.
 */

import { getMissionsByLevel, getUserMissionProgress, getMemberLevel, getLevelTitle } from "@/app/lib/missions";
import { getCachedMissionsList, setCachedMissionsList } from "@/app/lib/mission-cache";
import { getVerifier } from "@/app/lib/mission-verify/verifiers";
import { PROOF_HINTS } from "@/app/lib/mission-verify/proof-links";
import { BOX_MIN_LEVEL, PIZZA_BOX_LINK, VOUCH_MIN_LEVEL, type LevelGate } from "@/app/lib/level-gate";
import { BOX_PURCHASE_URL } from "@/app/lib/box-mafia";
import { inviteUrl } from "@/app/lib/referral-link";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

/** Whether a mission's verifier can approve it automatically (not "manual", not a semi pre-check). */
function isAutoChecked(key: string | null | undefined): boolean {
  return getVerifier(key)?.mode === "auto";
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
      /** Semi-automatic (Phase 4): the proof link is pre-checked on submit, then a reviewer approves. */
      semiChecked?: boolean;
      /** The submit form's placeholder for the proof link. */
      proofHint?: string;
      /** L3.1 "Invite a friend": the mission that shows the viewer's invite link. */
      referral?: boolean;
      progress: MissionProgress | null;
    }[];
  }[];
  currentLevel: number;
  levelTitle: string | null;
  /**
   * The level gates: level 4 needs a vouch received, level 5 a Rare Pizza
   * Box. `vouch` / `box` are the viewer's standing; `heldBack` means their
   * missions earn a higher level than they hold. Missions on every level
   * can be submitted regardless.
   */
  levelGate: {
    vouchMinLevel: number;
    boxMinLevel: number;
    vouch: LevelGate["vouch"];
    box: LevelGate["box"];
    heldBack: boolean;
    earnedLevel: number;
    /** Where to get a Rare Pizza Box. */
    boxLink: string;
  };
  isAuthenticated: boolean;
  /** The viewer's personal invite link (/join?ref=<memberId>), when signed in and onboarded. */
  inviteUrl?: string | null;
};

export async function getMissionsOverview(discordId: string | null | undefined): Promise<MissionsOverview> {
  const progressMap: Record<number, MissionProgress> = {};
  let currentLevel = 1;
  let levelTitle: string | null = null;
  let gate: LevelGate = { vouch: "not_needed", box: "not_needed" };
  let earnedLevel = 1;
  let myInviteUrl: string | null = null;

  if (discordId) {
    const progress = await getUserMissionProgress(discordId);
    const member = await getMemberLevel(discordId, { full: true });
    currentLevel = member.level;
    earnedLevel = member.earnedLevel;
    gate = member.gate;
    levelTitle = await getLevelTitle(currentLevel);
    const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null);
    myInviteUrl = memberId ? inviteUrl(memberId) : null;
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
        ...(getVerifier(m.verifierKey)?.mode === "semi" ? { semiChecked: true } : {}),
        ...(m.verifierKey && PROOF_HINTS[m.verifierKey] ? { proofHint: PROOF_HINTS[m.verifierKey] } : {}),
        ...(m.verifierKey === "referral" ? { referral: true } : {}),
        progress: progressMap[m.id] || null,
      })),
    }));
    if (!discordId) setCachedMissionsList(levels);
  }

  return {
    levels,
    currentLevel,
    levelTitle,
    levelGate: {
      vouchMinLevel: VOUCH_MIN_LEVEL,
      boxMinLevel: BOX_MIN_LEVEL,
      vouch: gate.vouch,
      box: gate.box,
      heldBack: earnedLevel > currentLevel,
      earnedLevel,
      boxLink: BOX_PURCHASE_URL || PIZZA_BOX_LINK,
    },
    isAuthenticated: !!discordId,
    inviteUrl: myInviteUrl,
  };
}
