// app/api/discord/interactions/route.ts
//
// Discord HTTP Interactions endpoint for the $PEP slash commands that replace
// UnbelievaBoat (see PEP_COMMANDS in app/lib/discord-interactions/commands.ts).
// Set this URL as the "Interactions Endpoint URL" of the PizzaDAO Discord
// application, then register the commands with
// scripts/discord/register-commands.mjs. See plans/unbelievaboat-replacement.md.
//
// Env: DISCORD_PUBLIC_KEY (hex, Developer Portal > General Information),
//      DISCORD_GUILD_ID, DISCORD_BOT_TOKEN (guild role names for
//      /collect), optional PEP_EMOJI (e.g. <:pepperoni:973304305979367444>).
// Flags: games.enabled (games).
// /missions: deferred reply, then the verifier run (dry run unless
//      missions.verifiersEnabled is edited in via the interaction webhook.
// /vouch, /level, /profile (discord.vouchCommandEnabled / levelCommandEnabled / profileCommandEnabled):
//      deferred ephemeral replies (app/lib/discord-interactions/member-commands.ts), 10 per member per minute.
// /task list | claim | mine | drop | add (discord.taskCommandEnabled): crew tasks, deferred ephemeral replies
//      (app/lib/discord-interactions/task-command.ts) over claimCrewTask (app/lib/crews/claim-task.ts), 10 per member per minute.
// /bounty list | claim | mine | giveup (discord.bountyCommandEnabled): deferred ephemeral replies
//      (app/lib/discord-interactions/bounty-command.ts) over the website's bounty functions, 10 per member per minute.
// /progress (calls.progressReportEnabled on): deferred public reply, then the crew's last call
//      action items and open tasks (app/lib/calls/progress-report.ts), 1 per channel per 2 min.
// /metalhead (discord.metalheadCommandEnabled on): spoken call updates and their stop / pause / resume / skip
//      controls, deferred ephemeral replies (app/lib/call-updates/command.ts), 10 per member per minute.
// /trivia leaderboard | start | skip | report | suggest (trivia.enabled on, production only): deferred replies
//      (app/lib/discord-interactions/trivia-command.ts); start and skip are admin only. 10 per member per minute.
// Mission review cards (missions.reviewCardsEnabled on): Approve / Release /
//      Reject buttons on the #work cards and the Reject modal. Checked with
//      canReviewMission(member.roles, level), never your own; deferred update,
//      then approveMission / rejectMission in after(). See
//      app/lib/discord-interactions/mission-review.ts.
// Admin money (/add-money, /remove-money): holders of ADMIN_ROLE_IDS
//      (app/ui/constants.ts) or of PEP_ADMIN_ROLE_IDS / PEP_ADMIN_ROLE_NAMES
//      (default "Pepperoni Mafia"); optional ADMIN_GRANT_MAX (default 10000)
//      and PEP_ADMIN_LOG_CHANNEL_ID (audit post via the bot token).
import { after, NextResponse } from "next/server";
import { verifyDiscordRequest } from "@/app/lib/discord-interactions/verify";
import { memberNamesByDiscordId } from "@/app/lib/member-names";
import { handleInteraction, type HandlerDeps, type Interaction, type MetalheadJob, type ProgressJob } from "@/app/lib/discord-interactions/handle";
import { liveCallChoices, metalheadEnabled, runMetalheadCommand } from "@/app/lib/call-updates/command";
import { progressEnabled, runProgressCommand } from "@/app/lib/calls/progress-command";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { runMemberCommand, type MemberCommandJob } from "@/app/lib/discord-interactions/member-commands";
import { runBountyCommand, type BountyJob, type BountyRow } from "@/app/lib/discord-interactions/bounty-command";
import { bountyPickChoices } from "@/app/lib/discord-interactions/bounty-choices";
import { runTaskCommand, type TaskJob } from "@/app/lib/discord-interactions/task-command";
import { runTriviaCommand, type SuggestResult, type TriviaJob } from "@/app/lib/discord-interactions/trivia-command";
import { adminSkipRound, adminStartRound, discordLeaderboard, reportLatestQuestion } from "@/app/lib/trivia/admin";
import { triviaLive } from "@/app/lib/trivia/enabled";
import { submitSuggestion } from "@/app/lib/trivia/suggestions";
import { addCrewChoices, findOpenDuplicate, myCrewTasks, openCrewTasks, taskPickChoices } from "@/app/lib/discord-interactions/task-choices";
import { createCrewTask } from "@/app/lib/crew-tasks-write";
import { canManageCrew } from "@/app/lib/crew-leads";
import { realCrews } from "@/app/lib/crew-id";
import { usesDb } from "@/app/lib/sheets-import/source";
import { claimCrewTask } from "@/app/lib/crews/claim-task";
import { claimBounty, getClaimedBounties, getCrewLabelMap, getOpenBounties, giveUpBounty } from "@/app/lib/bounties";
import { requireOnboarded } from "@/app/lib/economy";
import { giveVouch } from "@/app/lib/give-vouch";
import { getLevelInfo } from "@/app/lib/level-info";
import { getProfileStats } from "@/app/lib/profile-stats";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { disavowWarns } from "@/app/lib/discord-interactions/vouch-guard";
import { getGuildRoles } from "@/app/lib/discord-interactions/guild-roles";
import { doWork } from "@/app/lib/pep-earn/work";
import { collectIncome, resolveRoleIncome, roleIncomeConfig } from "@/app/lib/pep-earn/income";
import { gamesEnabled } from "@/app/lib/pep-games/config";
import { blackjackAction, startBlackjack } from "@/app/lib/pep-games/blackjack";
import { parseRouletteSpace, playRoulette } from "@/app/lib/pep-games/roulette";
import { playSlots } from "@/app/lib/pep-games/slots";
import { getLeaderboard, transfer } from "@/app/lib/economy";
import { buyItem, getShopItems } from "@/app/lib/shop";
import { loadSettings, type Settings } from "@/app/lib/settings";
import { adminAddMoney, adminGrantMax, adminRemoveMoney, isPepAdmin } from "@/app/lib/pep-admin";
import { makeEmbed } from "@/app/lib/discord-interactions/embeds";
import { postDiscordMessage } from "@/app/lib/discord-rest";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { prisma } from "@/app/lib/db";
import { checkKeyedRateLimit } from "@/app/lib/rate-limit";
import { runVerifiers } from "@/app/lib/mission-verify/engine";
import { runMissionsCommand } from "@/app/lib/mission-verify/discord-command";
import { announceMissionResults } from "@/app/lib/mission-verify/notify";
import { getMissionsOverview } from "@/app/lib/missions-overview";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { approveMission, getCompletionForReview, rejectMission } from "@/app/lib/missions";
import { canReviewMission, dprOnlyMinLevel } from "@/app/lib/mission-review-access";
import { invalidateProgressCache } from "@/app/lib/mission-cache";
import { reviewCardsEnabled, syncReviewCard } from "@/app/lib/mission-verify/review-cards";
import { postEphemeralFollowup, runReviewDecision, type ReviewDecisionJob } from "@/app/lib/mission-verify/review-decision";
import type { MissionReviewDeps } from "@/app/lib/discord-interactions/mission-review";
import type { FollowUpInteractionDeps } from "@/app/lib/discord-interactions/followups";
import { applyMemberAction, setDoneUrl } from "@/app/lib/followups/actions";
import { linkOffered } from "@/app/lib/followups/done-url";
import { notifyApprovers } from "@/app/lib/followups/notify";
import type { ReminderInteractionDeps } from "@/app/lib/discord-interactions/reminders";
import { callReviewHandlerDeps, callReviewRunDeps } from "@/app/lib/discord-interactions/call-review-defaults";
import { runCallReview } from "@/app/lib/discord-interactions/call-review-run";
import { syncCallReviewCard } from "@/app/lib/calls/review-cards";
import { stopCallReminders, stopProposalReminders } from "@/app/lib/reminders/prefs";
import { liveCommandEnabled, mayRunLive, runLiveCommand, type LiveJob } from "@/app/lib/calls/live-announce-command";
import { SITE_URL } from "@/app/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The deferred /metalhead work (script, text to speech, pizza-radio) runs in after(): allow it a minute.
export const maxDuration = 60;

async function getWallet(discordId: string): Promise<number> {
  // Read-only: looking someone up must not create rows for them.
  const econ = await prisma.economy.findUnique({ where: { id: discordId }, select: { wallet: true } });
  return econ?.wallet ?? 0;
}

/**
 * Post an admin grant to PEP_ADMIN_LOG_CHANNEL_ID after the reply is sent
 * (next/server `after`), so it never delays Discord's 3s deadline. A failed
 * post is logged, never surfaced.
 */
function logAdminGrant(text: string) {
  const channelId = process.env.PEP_ADMIN_LOG_CHANNEL_ID?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!channelId || !botToken) return;
  after(async () => {
    try {
      await postDiscordMessage({ kind: "bot", channelId, botToken }, { content: text, allowed_mentions: { parse: [] } });
    } catch (err) {
      console.error("[discord/interactions] admin log post failed:", err);
    }
  });
}

/** /missions: 1 per 60 s per member (plans/mission-verification.md §6.3). */
async function missionsRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("missions-command", discordId);
  return r.success ? null : new Date(r.reset);
}

/** The deferred /missions work, after the type-5 reply has gone out. */
function deferMissions(job: Parameters<NonNullable<HandlerDeps["missions"]>["defer"]>[0]) {
  after(async () => {
    const currency = process.env.PEP_EMOJI?.trim() || "$PEP";
    await runMissionsCommand(job, {
      isMember: async (id) => !!(await fetchMemberIdByDiscordId(id).catch(() => null)),
      run: (id, roles) => runVerifiers(id, { trigger: "discord", interactionRoles: roles }),
      overview: (id) => getMissionsOverview(id),
      announce: (view, id) =>
        announceMissionResults({ discordId: id, trigger: "discord", approvedTitles: view.approvedTitles, levelsPaid: view.levelsPaid }),
      currency,
      appUrl: (process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE_URL).replace(/\/$/, ""),
    });
  });
}

/** /progress: one report per channel per 2 minutes (it posts publicly). */
async function progressRateLimit(channelId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("progress-command", channelId);
  return r.success ? null : new Date(r.reset);
}

/** The deferred /progress work, after the type-5 reply has gone out. */
function deferProgress(job: ProgressJob) {
  after(async () => {
    await runProgressCommand(job);
  });
}

/** The deferred /live work, after the type-5 (ephemeral) reply has gone out. */
function deferLive(job: LiveJob) {
  after(async () => {
    await runLiveCommand(job);
  });
}

/** /metalhead: 10 per member per minute (private replies; the heavy work is capped per call). */
async function metalheadRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("metalhead-command", discordId);
  return r.success ? null : new Date(r.reset);
}

/** The deferred /metalhead work (build, speak or control), after the type-5 reply has gone out. */
function deferMetalhead(job: MetalheadJob) {
  after(async () => {
    await runMetalheadCommand(job);
  });
}

/** /vouch, /level, /profile: 10 per member per minute (they are private and cheap). */
async function memberCommandRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("member-command", discordId);
  return r.success ? null : new Date(r.reset);
}

const MEMBER_COMMAND_TOGGLES = {
  vouch: "discord.vouchCommandEnabled",
  level: "discord.levelCommandEnabled",
  profile: "discord.profileCommandEnabled",
} as const;

function deferMemberCommand(job: MemberCommandJob) {
  after(async () => {
    await runMemberCommand(job, {
      memberByDiscordId: fetchMemberByDiscordId,
      giveVouch: (voucherDiscordId, targetMemberId) =>
        giveVouch({ voucherDiscordId, targetMemberId }, { defer: (j) => after(() => j().then(() => undefined, () => undefined)) }),
      disavowWarns,
      levelInfo: getLevelInfo,
      profileStats: getProfileStats,
      appUrl: appUrl(),
    });
  });
}

/** /bounty: 10 per member per minute (private replies, cheap). */
async function bountyRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("bounty-command", discordId);
  return r.success ? null : new Date(r.reset);
}

/** The deferred /bounty work, after the type-5 reply has gone out. */
function deferBounty(job: BountyJob) {
  after(async () => {
    await runBountyCommand(job, {
      openBounties: (crewId) => getOpenBounties({ crewId }),
      claimedBy: getClaimedBounties,
      // Same as the web claim route: an onboarded user row, then the shared claim rules.
      claim: async (discordId, bountyId): Promise<BountyRow> => {
        await requireOnboarded(discordId);
        return claimBounty(discordId, bountyId);
      },
      giveUp: giveUpBounty,
      isMember: async (id) => !!(await fetchMemberIdByDiscordId(id)),
      crewLabels: getCrewLabelMap,
      appUrl: appUrl(),
    });
  });
}

/** Autocomplete for /bounty: crews (list), open bounties that aren't yours (claim), your claims (giveup). */
async function bountyChoices(kind: "crew" | "claim" | "giveup", discordId: string, query: string): Promise<Array<{ name: string; value: string | number }>> {
  if (kind === "crew") return progressCrewChoices(query);
  return bountyPickChoices(kind, discordId, query);
}

/** /task: 10 per member per minute (private replies, cheap). */
async function taskRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("task-command", discordId);
  return r.success ? null : new Date(r.reset);
}

/** /task add (writes a crew task): 5 per member per 10 minutes, on top of the general /task limit. */
async function taskAddRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("task-add", discordId);
  return r.success ? null : new Date(r.reset);
}

/** /trivia: 10 per member per minute (the replies are private or cheap; start and skip are admin only). */
async function triviaRateLimit(discordId: string): Promise<Date | null> {
  const r = await checkKeyedRateLimit("trivia-command", discordId);
  return r.success ? null : new Date(r.reset);
}

/** /trivia suggest (modal submit): validate and store; the daily cap (5 per member) is in the database. */
async function triviaSuggest(discordId: string, input: { question: string; answer: string; aliases: string; source: string; category: string }): Promise<SuggestResult> {
  const r = await submitSuggestion(discordId, input);
  return r.status === "invalid" ? { status: "invalid", field: r.field } : { status: r.status };
}

/** The deferred /trivia work, after the type-5 reply has gone out. */
function deferTrivia(job: TriviaJob) {
  after(async () => {
    await runTriviaCommand(job, { leaderboard: discordLeaderboard, startRound: () => adminStartRound(), skipRound: () => adminSkipRound(), reportLatest: reportLatestQuestion });
  });
}

/** Where a crew's tasks live: the database, a Google Sheet, or nowhere (not a real crew). */
async function taskCrewSource(crewId: string): Promise<"db" | "sheet" | "unknown"> {
  const { crews } = await getCrewMappings();
  if (!realCrews(crews).some((c) => c.id === crewId)) return "unknown";
  return (await usesDb("crewTasks", crewId)) ? "db" : "sheet";
}

/** The deferred /task work, after the type-5 reply has gone out. */
function deferTask(job: TaskJob) {
  after(async () => {
    await runTaskCommand(job, {
      openTasks: openCrewTasks,
      myTasks: async (discordId) => {
        const memberId = await fetchMemberIdByDiscordId(discordId);
        return memberId ? myCrewTasks(String(memberId)) : [];
      },
      // The same rules, audit trail and activation as the crew page's Claim / Give up buttons. Discord refuses closed tasks.
      claim: (discordId, taskId) => claimCrewTask({ discordId, taskId, action: "claim", requireOpen: true, awaitActivation: true }),
      drop: (discordId, taskId) => claimCrewTask({ discordId, taskId, action: "giveup" }),
      isMember: async (id) => !!(await fetchMemberIdByDiscordId(id)),
      crewLabels: getCrewLabelMap,
      canManageCrew,
      crewSource: taskCrewSource,
      findOpenDuplicate,
      // No transaction handle, so createCrewTask writes the audit event and invalidates the crew cache itself.
      create: (crewId, input, actor, eventData) => createCrewTask(crewId, input, actor, eventData),
      appUrl: appUrl(),
    });
  });
}

/** Autocomplete for /task: crews (list), open tasks (claim), the tasks you lead (drop), crews to add to (add; the caller's own first). */
async function taskChoices(kind: "crew" | "claim" | "drop" | "addCrew", discordId: string, query: string, roles: string[] = []): Promise<Array<{ name: string; value: string | number }>> {
  if (kind === "crew") return progressCrewChoices(query);
  if (kind === "addCrew") {
    const memberId = await fetchMemberIdByDiscordId(discordId);
    return addCrewChoices(memberId ? String(memberId) : null, query, roles);
  }
  const memberId = kind === "drop" ? await fetchMemberIdByDiscordId(discordId) : null;
  return taskPickChoices(kind, memberId ? String(memberId) : null, query);
}

/** Autocomplete for the /progress crew option: crews whose label or id contains the query. */
async function progressCrewChoices(query: string): Promise<Array<{ name: string; value: string }>> {
  const q = query.trim().toLowerCase();
  const { crews } = await getCrewMappings();
  return crews
    .filter((c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q))
    .slice(0, 25)
    .map((c) => ({ name: c.label.slice(0, 100), value: c.id }));
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE_URL).replace(/\/$/, "");

/**
 * The decision behind a review-card button / the Reject modal, after the
 * deferred update (type 6) has gone out: the same approveMission /
 * rejectMission as the web panel (race-safe settle + payout, audited with via
 * "discord"), then the card edit and level-up announcements.
 */
function decideReview(job: ReviewDecisionJob) {
  after(async () => {
    await runReviewDecision(job, {
      approve: (reviewerId, id, note) => approveMission(reviewerId, id, note, "discord"),
      reject: (reviewerId, id, reason) => rejectMission(reviewerId, id, reason, "discord"),
      handledBy: getCompletionForReview,
      syncCard: (id, card) => syncReviewCard(id, undefined, card),
      announce: (discordId, levelsPaid) => announceMissionResults({ discordId, trigger: "review", approvedTitles: [], levelsPaid }),
      invalidate: invalidateProgressCache,
      followup: (applicationId, token, embed) => postEphemeralFollowup(applicationId, token, embed),
    });
  });
}

const missionReview: MissionReviewDeps = {
  enabled: () => reviewCardsEnabled(),
  target: getCompletionForReview,
  canReview: (roles, level) => canReviewMission(roles, level),
  dprOnlyMinLevel,
  decide: decideReview,
  refresh: (id, card) => after(() => syncReviewCard(id, undefined, card).then(() => undefined)),
  appUrl: appUrl(),
};

// Call review card buttons (calls.reviewCardsEnabled + calls.capoReviewEnabled): the preview, the publish
// and the hold run after the response, within Discord's 3 s window for the answer itself.
const callReview = callReviewHandlerDeps(
  appUrl(),
  (job) => after(() => runCallReview(job, callReviewRunDeps(appUrl())).then(() => undefined, (err) => console.error("[call review] job failed:", err))),
  (id) => after(() => syncCallReviewCard(id).then(() => undefined)),
);

const followups: FollowUpInteractionDeps = {
  respond: (a) => applyMemberAction({ ...a, actorId: a.discordId }),
  addLink: (a) => setDoneUrl({ ...a, actorId: a.discordId }),
  canLink: async (id, discordId) => {
    const row = await prisma.followUp.findUnique({ where: { id }, select: { ownerDiscordId: true, actionKey: true } });
    return !!row && row.ownerDiscordId === discordId && (await linkOffered(row));
  },
  notify: (text) => after(() => notifyApprovers(text).then(() => undefined, () => undefined)),
  owns: async (id, discordId) => {
    const row = await prisma.followUp.findUnique({ where: { id }, select: { ownerDiscordId: true } });
    return !!row && row.ownerDiscordId === discordId;
  },
};

const reminders: ReminderInteractionDeps = {
  stop: (discordId, kind) => (kind === 'proposals' ? stopProposalReminders(discordId) : stopCallReminders(discordId)),
  settingsUrl: async (discordId) => {
    const memberId = await fetchMemberIdByDiscordId(discordId);
    return memberId ? `${SITE_URL}/profile/${encodeURIComponent(memberId)}/edit` : null;
  },
};

function deps(guildId: string | undefined, settings: Settings): HandlerDeps {
  return {
    guildId,
    memberName: async (id) => (await memberNamesByDiscordId([id])).get(id)?.name ?? null,
    currency: process.env.PEP_EMOJI?.trim() || "$PEP",
    getWallet,
    doWork,
    collectIncome: async (discordId, roleIds) => {
      const { resolved, unresolved } = resolveRoleIncome(roleIncomeConfig(process.env.ROLE_INCOME_JSON, await loadSettings()), guildId ? await getGuildRoles(guildId) : null);
      if (unresolved.length) console.warn("[collect-income] unresolved roles:", unresolved.join(", "));
      return { ...(await collectIncome(discordId, roleIds, resolved)), unresolved };
    },
    pay: (from, to, amount) => transfer(from, to, amount),
    leaderboard: () => getLeaderboard(10),
    gamesEnabled,
    startBlackjack: (id, bet) => startBlackjack(id, bet, { source: "discord" }),
    blackjackAction: (id, gameId, action) => blackjackAction(id, gameId, action),
    roulette: (id, bet, space) => playRoulette(id, bet, parseRouletteSpace(space)),
    slots: (id, bet) => playSlots(id, bet),
    shopItems: getShopItems,
    buy: (id, itemId, qty) => buyItem(id, itemId, qty),
    isAdmin: (roles) =>
      isPepAdmin(roles, { baseRoleIds: ADMIN_ROLE_IDS, getGuildRoles: async () => (guildId ? getGuildRoles(guildId) : null) }),
    adminGrantMax: adminGrantMax(process.env, settings),
    addMoney: adminAddMoney,
    removeMoney: adminRemoveMoney,
    logAdmin: logAdminGrant,
    missions: { rateLimit: missionsRateLimit, defer: deferMissions },
    memberCommands: { enabled: (name) => toggleEnabled(MEMBER_COMMAND_TOGGLES[name]), rateLimit: memberCommandRateLimit, defer: deferMemberCommand },
    progress: { enabled: progressEnabled, rateLimit: progressRateLimit, defer: deferProgress, crewChoices: progressCrewChoices },
    task: { enabled: () => toggleEnabled("discord.taskCommandEnabled"), rateLimit: taskRateLimit, addRateLimit: taskAddRateLimit, defer: deferTask, choices: taskChoices },
    bounty: { enabled: () => toggleEnabled("discord.bountyCommandEnabled"), rateLimit: bountyRateLimit, defer: deferBounty, choices: bountyChoices },
    live: {
      enabled: () => liveCommandEnabled(),
      canRun: (roles) =>
        mayRunLive(roles, (r) => isPepAdmin(r, { baseRoleIds: ADMIN_ROLE_IDS, getGuildRoles: async () => (guildId ? getGuildRoles(guildId) : null) })),
      defer: deferLive,
    },
    trivia: { enabled: () => triviaLive(), rateLimit: triviaRateLimit, defer: deferTrivia, suggest: triviaSuggest },
    metalhead: { enabled: () => metalheadEnabled(), rateLimit: metalheadRateLimit, defer: deferMetalhead, callChoices: liveCallChoices },
    missionReview,
    callReview,
    followups,
    reminders,
  };
}

export async function POST(req: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey) return NextResponse.json({ error: "Interactions not configured" }, { status: 503 });

  const rawBody = await req.text();
  const ok = verifyDiscordRequest({
    publicKeyHex: publicKey,
    signatureHex: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "invalid request signature" }, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const res = await handleInteraction(interaction, deps(process.env.DISCORD_GUILD_ID?.trim(), await loadSettings()));
    return NextResponse.json(res);
  } catch (err) {
    console.error("[discord/interactions] handler failed:", err);
    // Still a valid interaction response so the user sees something.
    return NextResponse.json({
      type: 4,
      data: {
        embeds: [makeEmbed("error", "Something went wrong. Please try again.")],
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
  }
}
