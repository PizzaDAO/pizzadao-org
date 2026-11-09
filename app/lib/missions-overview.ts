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
import { defaultSources } from "@/app/lib/mission-verify/sources";
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
      /** L1 "follow on X": only the X link is verified; the follow is on the honor system. */
      xFollow?: boolean;
      /** L5.3 "Own a Rare Pizza Box": where to get one (an extra link on the card). */
      getBoxUrl?: string;
      /** "Get vouched by N members" (the vouch_received verifier): shows the member's vouch link; `have` only when signed in. */
      vouchLink?: { need: number; sources: string[]; have?: number };
      /** Handbook page that explains this mission (an internal path, validated). */
      guideHref?: string;
      /** Optional: not needed to complete the level. */
      bonus?: boolean;
      /** PEP paid once when a bonus mission is approved. */
      bonusReward?: number;
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
  /** The viewer's own profile edit page (where Connect X lives), when signed in and onboarded. */
  profileEditHref?: string | null;
  /** The viewer's own member id (for their public vouch link), when signed in and onboarded. */
  memberId?: string | null;
};

/** The vouch_received threshold and sources from a mission row (defaults like the verifier; a bad row gets the defaults). */
function vouchParams(raw: unknown): { need: number; sources: string[] } {
  try {
    const p = getVerifier("vouch_received")!.parse(raw) as { min: number; sources: string[] };
    return { need: p.min, sources: p.sources };
  } catch {
    return { need: 1, sources: ["PIZZADAO"] };
  }
}

/** Received vouches for a member: distinct other members, counted like the verifier. */
async function countReceivedVouches(memberId: string, sources: string[]): Promise<number> {
  const rows = await defaultSources.getVouchesReceived(memberId, sources);
  return new Set(rows.filter((r) => r.followerId && r.followerId !== memberId && sources.includes(r.source)).map((r) => r.followerId)).size;
}

export async function getMissionsOverview(discordId: string | null | undefined): Promise<MissionsOverview> {
  const progressMap: Record<number, MissionProgress> = {};
  let currentLevel = 1;
  let levelTitle: string | null = null;
  let myInviteUrl: string | null = null;
  let myMemberId: string | null = null;
  let myProfileEditHref: string | null = null;
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
    myMemberId = memberId || null;
    myInviteUrl = memberId ? inviteUrl(memberId) : null;
    myProfileEditHref = memberId ? `/profile/${encodeURIComponent(memberId)}/edit` : null;
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
      title: (missions.find((m) => m.levelTitle) ?? missions[0])?.levelTitle || null,
      // The level reward is shared by its required missions; a bonus row's `reward` is not it.
      reward: (missions.find((m) => !m.bonus) ?? missions[0])?.reward || 0,
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
        ...(m.verifierKey === "vouch_received" ? { vouchLink: vouchParams(m.verifierParams) } : {}),
        ...(m.verifierKey === "x_linked" ? { xFollow: true } : {}),
        ...(acceptsManualSubmission({ verifierKey: m.verifierKey, proofKind: m.proofKind }) ? {} : { noManualSubmit: true }),
        ...(m.bonus ? { bonus: true, bonusReward: m.bonusReward ?? 0 } : {}),
        ...guideField(m.guideHref),
        ...(m.verifierKey === "rare_pizza_box" ? { getBoxUrl: BOX_PURCHASE_URL || PIZZA_BOX_LINK } : {}),
        progress: progressMap[m.id] || null,
      })),
    }));
    if (!discordId) setCachedMissionsList(levels);
  }

  // Per-viewer: how many vouches they have received (never written into the shared anonymous cache).
  if (myMemberId) {
    const memberId = myMemberId;
    const counts = new Map<string, number>();
    const enriched: MissionsOverview["levels"] = [];
    for (const l of levels) {
      const missions: MissionsOverview["levels"][number]["missions"] = [];
      for (const m of l.missions) {
        if (!m.vouchLink) { missions.push(m); continue; }
        const { sources } = m.vouchLink;
        const key = sources.join(",");
        if (!counts.has(key)) counts.set(key, await countReceivedVouches(memberId, sources).catch(() => -1));
        const have = counts.get(key)!;
        missions.push(have < 0 ? m : { ...m, vouchLink: { ...m.vouchLink, have } });
      }
      enriched.push({ ...l, missions });
    }
    levels = enriched;
  }

  return { levels, currentLevel, levelTitle, paidLevels, earnedPep, isAuthenticated: !!discordId, inviteUrl: myInviteUrl, profileEditHref: myProfileEditHref, memberId: myMemberId };
}
