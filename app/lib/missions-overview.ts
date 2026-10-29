/**
 * Missions overview for the /missions page: every active mission grouped by
 * level, plus the viewer's progress and current level when signed in.
 *
 * Same shape and rules as GET /api/missions (including the shared in-memory
 * cache of the anonymous mission list), so the server-rendered page and the
 * client refetch after a submission agree.
 */

import { getMissionsByLevel, getUserMissionProgress, getCurrentLevel, getLevelTitle, getPaidSummary } from "@/app/lib/missions";
import { getCachedMissionsList, setCachedMissionsList } from "@/app/lib/mission-cache";
import { acceptsManualSubmission } from "@/app/lib/mission-verify/policy";
import { getVerifier } from "@/app/lib/mission-verify/verifiers";
import { PROOF_HINTS } from "@/app/lib/mission-verify/proof-links";
import { BOX_PURCHASE_URL } from "@/app/lib/box-mafia";
import { PIZZA_BOX_LINK } from "@/app/lib/rare-pizza-box";
import { inviteUrl } from "@/app/lib/referral-link";
import { parseGuideHref } from "@/app/lib/guide-href";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

/** Whether a mission's verifier can approve it automatically (not "manual", not a semi pre-check). */
function isAutoChecked(key: string | null | undefined): boolean {
  return getVerifier(key)?.mode === "auto";
}

/** guideHref passes through only if it is still a valid internal handbook path (a bad row adds no link). */
function guideField(raw: string | null | undefined): { guideHref?: string } {
  const g = parseGuideHref(raw);
  return g.ok && g.value ? { guideHref: g.value } : {};
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
      /** L5.3 "Own a Rare Pizza Box": where to get one (an extra link on the card). */
      getBoxUrl?: string;
      /** Handbook page that explains this mission (an internal path, validated). */
      guideHref?: string;
      /** Checked automatically with nothing to submit: no submit form (the submit API refuses it too). */
      noManualSubmit?: boolean;
      progress: MissionProgress | null;
    }[];
  }[];
  currentLevel: number;
  levelTitle: string | null;
  /** Levels whose reward was actually paid (the MISSION_REWARD ledger), and the PEP total. */
  paidLevels: number[];
  earnedPep: number;
  isAuthenticated: boolean;
  /** The viewer's personal invite link (/join?ref=<memberId>), when signed in and onboarded. */
  inviteUrl?: string | null;
};

export async function getMissionsOverview(discordId: string | null | undefined): Promise<MissionsOverview> {
  const progressMap: Record<number, MissionProgress> = {};
  let currentLevel = 1;
  let levelTitle: string | null = null;
  let myInviteUrl: string | null = null;
  let paidLevels: number[] = [];
  let earnedPep = 0;

  if (discordId) {
    const progress = await getUserMissionProgress(discordId);
    currentLevel = await getCurrentLevel(discordId);
    levelTitle = await getLevelTitle(currentLevel);
    const paid = await getPaidSummary(discordId);
    paidLevels = [...paid.levels].sort((a, b) => a - b);
    earnedPep = paid.pep;
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
        ...(acceptsManualSubmission({ verifierKey: m.verifierKey, proofKind: m.proofKind }) ? {} : { noManualSubmit: true }),
        ...guideField(m.guideHref),
        ...(m.verifierKey === "rare_pizza_box" ? { getBoxUrl: BOX_PURCHASE_URL || PIZZA_BOX_LINK } : {}),
        progress: progressMap[m.id] || null,
      })),
    }));
    if (!discordId) setCachedMissionsList(levels);
  }

  return { levels, currentLevel, levelTitle, paidLevels, earnedPep, isAuthenticated: !!discordId, inviteUrl: myInviteUrl };
}
