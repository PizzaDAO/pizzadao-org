import { prisma } from "@/app/lib/db";
import { recordActivationLater as recordActivation } from "@/app/lib/activation";
import { SIGNUP_DRAFT_COOKIE } from "@/app/lib/signup-draft";
import { Prisma } from "@prisma/client";
// app/api/profile/route.ts
import { after, NextResponse } from "next/server";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";
import { getSession } from "@/app/lib/session";
import { saveMemberTimezone } from "@/app/lib/city-timezone";
import { parseTurtlesFromSheet } from "@/app/lib/discord-roles";
import { sendWelcomeMessage } from "@/app/lib/discord-webhook";
import { parseGvizJson } from "@/app/lib/gviz-parser";
import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import { GvizCell } from "@/app/lib/types/gviz";
import { withErrorHandling } from "@/app/lib/errors/error-response";
import { UnauthorizedError, ForbiddenError, ValidationError, ExternalServiceError } from "@/app/lib/errors/api-errors";
import { fetchMemberById, fetchMemberIdByDiscordId, invalidateMembersCache } from "@/app/lib/sheets/member-repository";
import { chooseInviter, recordReferral, type RecordReferralResult } from "@/app/lib/referrals";
import { creditPendingItemGrantsOnLogin } from "@/app/lib/shop-grants";
import { readRefCookie, refCookieOptions, REF_COOKIE } from "@/app/lib/referral-cookie";
import { emitMissionEvent } from "@/app/lib/mission-verify/events";
import { syncDiscordMember } from "@/app/lib/services/discord-api";
import { validateProfilePayload, sanitizeDisplayName } from "@/app/lib/profile/validation";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { getRegionRoleId, ALL_REGION_ROLE_IDS } from "@/app/lib/region-mapping";
import { registerWithMemberId } from "@/app/lib/member-registration";
import { crewIdToLabel } from "@/app/lib/crew-labels";

export const runtime = "nodejs";

function clampStr(s: unknown, max: number) {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}
function clampBool(v: unknown) {
  return v === true || v === "true" || v === 1 || v === "1";
}

// --- Discord helpers ---
function extractRoleIdFromMention(s: unknown): string | null {
  const str = String(s ?? "").trim();
  // matches <@&123> or just 123
  const m = str.match(/^<@&(\d+)>$/) || str.match(/^(\d+)$/);
  return m ? m[1] : null;
}

// --- crew mapping lookup (server-side) ---
async function fetchCrewRoleIds(selectedCrewIds: string[]): Promise<string[]> {
  if (!selectedCrewIds.length) return [];

  // Use direct function call instead of HTTP fetch to avoid Vercel deployment protection issues
  const { crews } = await getCrewMappings();

  const byId = new Map<string, { id: string; role?: string }>();
  for (const c of crews) {
    if (c?.id) byId.set(String(c.id), c);
  }

  const roleIds: string[] = [];
  for (const id of selectedCrewIds) {
    const row = byId.get(String(id));
    const roleId = extractRoleIdFromMention(row?.role);
    if (roleId) roleIds.push(roleId);
  }
  return Array.from(new Set(roleIds));
}

/**
 * Fetch with redirect handling for Apps Script.
 * Apps Script returns 302 redirects that need to be followed manually for POST requests.
 * The redirect URL should be fetched with GET to retrieve the response.
 */

// --- main handler ---
export async function writeToSheet(payload: unknown) {
  const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (!url) throw new Error("Missing Sheets webapp env vars");

  const { status: sheetStatus, text } = await fetchWithRedirect(url, payload);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch { }

  if (sheetStatus < 200 || sheetStatus >= 300 || (parsed as any)?.ok === false || ((parsed as any)?.crewSync && (parsed as any).crewSync.ok === false)) {
    throw new Error(JSON.stringify((parsed as any)?.crewSync?.error ?? (parsed as any)?.details ?? parsed ?? text));
  }

  // Every members-sheet write funnels through here (profile, wallet, Discord
  // role sync): expire cached members-sheet reads.
  invalidateMembersCache();
  return parsed;
}

function normalizeTurtleKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * TURTLE_ROLE_IDS in your codebase might be shaped a few different ways.
 * This tries common shapes:
 * - keys are "LEONARDO" etc
 * - keys are "leonardo"
 * - keys are "Leonardo"
 * - keys are "leonardo_role_id"
 */
function resolveTurtleRoleId(turtleName: string): string | null {
  const raw = String(turtleName ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const title = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  // Handle "Foot Clan" -> "FOOT_CLAN" (spaces to underscores, uppercase)
  const upperUnderscore = raw.toUpperCase().replace(/\s+/g, "_");

  const turtleRoleIdsRecord = TURTLE_ROLE_IDS as Record<string, unknown>;
  const candidates = [
    TURTLE_ROLE_IDS[upper as keyof typeof TURTLE_ROLE_IDS],
    turtleRoleIdsRecord[upperUnderscore], // "FOOT_CLAN"
    turtleRoleIdsRecord[lower],
    turtleRoleIdsRecord[title],
    turtleRoleIdsRecord[`${normalizeTurtleKey(raw)}_role_id`],
    turtleRoleIdsRecord[`${upper}_ROLE_ID`],
  ].filter(Boolean);

  return candidates.length ? String(candidates[0]) : null;
}

const POST_HANDLER = async (req: Request) => {
  const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error("Missing Sheets webapp env vars");
  }

  const session = await getSession();
  if (!session?.discordId) {
    throw new UnauthorizedError();
  }

  const body = await req.json();

  // Get submitted turtles from form
  // Only save turtles that the user explicitly selected - don't auto-add Discord roles
  const submittedTurtles = Array.isArray(body.turtles)
    ? body.turtles.map((x: unknown) => clampStr(x, 40)).filter(Boolean)
    : [];
  const turtlesArr = submittedTurtles;

  const crewsArr = Array.isArray(body.crews)
    ? body.crews.map((x: unknown) => clampStr(x, 40)).filter(Boolean)
    : [];

  const memberId = clampStr(body.memberId ?? "", 20);
  const autoAssignMemberId = body.autoAssignMemberId === true && !memberId;
  if (!memberId && !autoAssignMemberId) throw new ValidationError("Member ID is required");

  // Validate mediaType
  const mediaType = body.mediaType === "movie" || body.mediaType === "tv" ? body.mediaType : undefined;

  const payload = {
    secret,
    source: clampStr(body.source ?? "web", 20),
    sessionId: clampStr(body.sessionId ?? "", 80),

    mafiaName: sanitizeDisplayName(body.mafiaName),
    topping: clampStr(body.topping, 50),

    mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
    resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
    tmdbMovieId: clampStr(body.tmdbMovieId, 30),
    releaseDate: clampStr(body.releaseDate, 20),
    mediaType,

    city: clampStr(body.city, 120),
    cityRegion: clampStr(body.cityRegion ?? "", 40),

    // legacy + new
    turtle: clampStr(body.turtle ?? (turtlesArr.length ? turtlesArr.join(", ") : ""), 200),
    turtles: turtlesArr,

    crews: crewsArr.map(crewIdToLabel),
    memberId,

    // Identity comes from cookie session, never from client body
    discordId: clampStr(session.discordId, 64),
    discordJoined: clampBool(body.discordJoined),

    // richer raw for debugging (no secret)
    raw: {
      source: clampStr(body.source ?? "web", 20),
      sessionId: clampStr(body.sessionId ?? "", 80),
      mafiaName: sanitizeDisplayName(body.mafiaName),
      topping: clampStr(body.topping, 50),
      mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
      resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
      tmdbMovieId: clampStr(body.tmdbMovieId, 30),
      releaseDate: clampStr(body.releaseDate, 20),
      mediaType,
      city: clampStr(body.city, 120),
      turtle: clampStr(body.turtle ?? (turtlesArr.length ? turtlesArr.join(", ") : ""), 200),
      turtles: turtlesArr,
      crews: crewsArr.map(crewIdToLabel),
      memberId,
      discordId: clampStr(session.discordId, 64),
      discordJoined: clampBool(body.discordJoined),
    },
  };

  // Basic validation (create + update should both require a name)
  if (!payload.mafiaName) {
    throw new ValidationError("Mafia name is required");
  }

  /**
   * Authorization: if updating a specific memberId, enforce ownership
   * Only the Discord user recorded on that row may edit it.
   *
   * For NEW signups: memberId is provided but row doesn't exist yet - this is allowed
   * For UPDATES: memberId exists in sheet - verify the discordId matches
   */
  let isNewSignup = true; // Track if this is a new signup (for welcome message)
  if (payload.memberId) {
    // Uncached on purpose: this ownership check guards the write below.
    const row = await fetchMemberById(payload.memberId, { fresh: true });

    if (row) {
      // Row exists - this is an UPDATE, verify ownership
      isNewSignup = false;
      const sheetDiscord = String(row.discordId || "").trim();
      if (!sheetDiscord) {
        throw new ForbiddenError("Member is not claimed yet. Use the claim flow first.");
      }

      if (sheetDiscord !== payload.discordId) {
        throw new ForbiddenError("Cannot edit another member");
      }

      // Optional safety: prevent blank-overwrite updates
      const hasAnyUpdateField =
        Boolean(payload.city) || payload.turtles.length > 0 || payload.crews.length > 0 || Boolean(payload.topping);
      if (!hasAnyUpdateField) {
        throw new ValidationError("No update fields provided");
      }
    }
    // If row doesn't exist, it's a NEW signup with a chosen memberId - allow it to proceed
  }

  // L3.1 referrals (D4) count a member's FIRST onboarding only: a new row,
  // and no members-sheet row for this Discord account yet.
  const firstOnboarding =
    isNewSignup && !(await fetchMemberIdByDiscordId(payload.discordId, { fresh: true }).catch(() => null));

  // 1) Write to Sheets
  let parsed: unknown;
  try {
    if (autoAssignMemberId) {
      const registration = await registerWithMemberId(payload.discordId, async assignedId => {
        payload.memberId = assignedId;
        payload.raw.memberId = assignedId;
        return writeToSheet(payload);
      });
      parsed = { ...(registration.result as Record<string, unknown>), memberId: registration.memberId };
    } else {
      parsed = await writeToSheet(payload);
    }
  } catch (e: unknown) {
    if (e instanceof ValidationError) throw e;
    recordActivation('profile_save_failed', { actor: payload.sessionId, discordId: payload.discordId, code: 'sheet_write' });
    console.error('[profile] sheet write failed:', e);
    throw new ExternalServiceError('Google Sheets');
  }

  // 1b) Timezone (pizzaiolo-13628). The Crew sheet has no Timezone column, so
  // the zone resolved from the onboarding city lives in MemberProfileExtras.
  // Best-effort: never fails the submit.
  if (payload.memberId && body.timezone) {
    await saveMemberTimezone(payload.memberId, body.timezone);
  }

  // 2) Sync Discord
  let discordResult: unknown = null;

  if (payload.discordId) {
    const guildId = process.env.DISCORD_GUILD_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!guildId || !botToken) {
      discordResult = { ok: false, error: "Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN" };
    } else {
      // Turtle role IDs (payload.turtles are like "Leonardo", "Raphael", ...)
      const turtleRoleIds = payload.turtles
        .map((t: unknown) => resolveTurtleRoleId(String(t)))
        .filter(Boolean) as string[];

      // Crew role IDs from crew mappings table (column "role")
      let crewRoleIds: string[] = [];
      let crewLookupError: string | null = null;
      try {
        crewRoleIds = await fetchCrewRoleIds(payload.crews);
      } catch (e: unknown) {
        crewRoleIds = [];
        console.error("[profile] crew role lookup failed:", e);
        crewLookupError = "Crew role lookup failed";
      }

      // Region role ID from city selection
      const regionRoleId = payload.cityRegion ? getRegionRoleId(payload.cityRegion) : null;

      try {
        const sync = await syncDiscordMember({
          guildId,
          botToken,
          userId: payload.discordId,
          nickname: payload.mafiaName,
          turtleRoleIds,
          crewRoleIds,
          regionRoleId: regionRoleId ?? undefined,
          allRegionRoleIds: ALL_REGION_ROLE_IDS,
        });

        discordResult = {
          ...sync,
          turtleRoleIds,
          crewRoleIds,
          regionRoleId,
          crewLookupError, // Preserve any crew lookup error for debugging
        };
      } catch (e: unknown) {
        discordResult = {
          ok: false,
          error: "Discord sync failed",
          turtleRoleIds,
          crewRoleIds,
          regionRoleId,
          crewLookupError, // Preserve any crew lookup error for debugging
        };
      }
    }
  }

  // 3) Send message to Discord for both new signups and profile updates
  let welcomeResult: unknown = null;
  if (payload.discordId && payload.memberId) {
    welcomeResult = await sendWelcomeMessage({
      discordId: payload.discordId,
      memberId: payload.memberId,
      mafiaName: payload.mafiaName,
      city: payload.city,
      topping: payload.topping,
      mafiaMovie: payload.resolvedMovieTitle || payload.mafiaMovieTitle,
      mediaType: payload.mediaType,
      turtles: payload.turtles,
      crews: payload.crews,
      isNewSignup,
    });
  }

  // 4) Who invited them (L3.1, D4): the "Who invited you?" step's choice, or
  // the /join?ref= invite-link cookie. Completing onboarding is what
  // qualifies the referral; the inviter's referral verifier re-runs in the
  // background. Self-referrals are refused inside recordReferral. Never fails
  // the profile save.
  // First onboarding: credit any held UnbelievaBoat item grants (also done
  // on login; idempotent, so whichever runs first wins). Never fails the save.
  if (firstOnboarding && payload.discordId) {
    const discordId = payload.discordId;
    after(() => creditPendingItemGrantsOnLogin(discordId));
  }

  const cookieRef = readRefCookie(req);
  let referral: RecordReferralResult | null = null;
  if (firstOnboarding) {
    const pick = chooseInviter(body.invitedBy, cookieRef);
    if (pick.memberId) {
      referral = await recordReferral({
        inviteeDiscordId: payload.discordId,
        inviteeMemberId: payload.memberId || null,
        inviterMemberId: pick.memberId,
        via: pick.via,
        inviteCode: pick.inviteCode,
      });
      const inviter = referral.inviterDiscordId;
      if (inviter && (referral.outcome === "recorded" || referral.outcome === "recorded_flagged")) {
        after(() => emitMissionEvent(inviter, "referral_created").then(() => undefined));
      }
    }
  }

  const res = NextResponse.json({
    ok: true,
    discord: discordResult,
    sheets: parsed,
    welcome: welcomeResult,
    isNewSignup,
    referral: referral ? { outcome: referral.outcome } : null,
  });
  if (cookieRef) res.cookies.set(REF_COOKIE, "", refCookieOptions(req, 0));
  if (firstOnboarding) {
    recordActivation("profile_created", { actor: payload.sessionId, discordId: payload.discordId });
    res.cookies.set(SIGNUP_DRAFT_COOKIE, "", refCookieOptions(req, 0));
    after(async () => {
      try { await prisma.magicLoginToken.updateMany({ where: { discordId: payload.discordId }, data: { signupDraft: Prisma.DbNull } }); } catch {}
    });
  }
  return res;
};

export const POST = withErrorHandling(POST_HANDLER);
