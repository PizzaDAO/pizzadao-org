// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";
import { getSession } from "@/app/lib/session";
import { parseTurtlesFromSheet } from "@/app/lib/discord-roles";
import { sendWelcomeMessage } from "@/app/lib/discord-webhook";
import { parseGvizJson } from "@/app/lib/gviz-parser";
import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import { GvizCell } from "@/app/lib/types/gviz";
import { withErrorHandling } from "@/app/lib/errors/error-response";
import { UnauthorizedError, ForbiddenError, ValidationError, ExternalServiceError } from "@/app/lib/errors/api-errors";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { syncDiscordMember } from "@/app/lib/services/discord-api";
import { validateProfilePayload } from "@/app/lib/profile/validation";

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
type CrewOption = { id: string; role?: string };
type CrewMappingsResponse = { crews: CrewOption[] };

function getBaseUrl(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function fetchCrewRoleIds(req: Request, selectedCrewIds: string[]): Promise<string[]> {
  if (!selectedCrewIds.length) return [];

  const base = getBaseUrl(req);
  const res = await fetch(`${base}/api/crew-mappings`, { cache: "no-store" });
  const data = (await res.json()) as unknown;
  if (!res.ok) throw new Error((data as any)?.error || "Failed to load crew mappings (server)");

  const crews: CrewOption[] = Array.isArray((data as any)?.crews) ? (data as any).crews : [];
  const byId = new Map<string, CrewOption>();
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

  const payload = {
    secret,
    source: clampStr(body.source ?? "web", 20),
    sessionId: clampStr(body.sessionId ?? "", 80),

    mafiaName: clampStr(body.mafiaName, 64),
    topping: clampStr(body.topping, 50),

    mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
    resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
    tmdbMovieId: clampStr(body.tmdbMovieId, 30),
    releaseDate: clampStr(body.releaseDate, 20),

    city: clampStr(body.city, 120),

    // legacy + new
    turtle: clampStr(body.turtle ?? (turtlesArr.length ? turtlesArr.join(", ") : ""), 200),
    turtles: turtlesArr,

    crews: crewsArr,
    memberId,

    // Identity comes from cookie session, never from client body
    discordId: clampStr(session.discordId, 64),
    discordJoined: clampBool(body.discordJoined),

    // richer raw for debugging (no secret)
    raw: {
      source: clampStr(body.source ?? "web", 20),
      sessionId: clampStr(body.sessionId ?? "", 80),
      mafiaName: clampStr(body.mafiaName, 64),
      topping: clampStr(body.topping, 50),
      mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
      resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
      tmdbMovieId: clampStr(body.tmdbMovieId, 30),
      releaseDate: clampStr(body.releaseDate, 20),
      city: clampStr(body.city, 120),
      turtle: clampStr(body.turtle ?? (turtlesArr.length ? turtlesArr.join(", ") : ""), 200),
      turtles: turtlesArr,
      crews: crewsArr,
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
    const row = await fetchMemberById(payload.memberId);

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

  // 1) Write to Sheets
  let parsed: unknown;
  try {
    parsed = await writeToSheet(payload);
  } catch (e: unknown) {
    throw new ExternalServiceError('Google Sheets', (e as any)?.message);
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
      try {
        crewRoleIds = await fetchCrewRoleIds(req, payload.crews);
      } catch (e: unknown) {
        crewRoleIds = [];
        discordResult = { ok: false, error: `Crew role lookup failed: ${(e as any)?.message ?? "unknown"}` };
      }

      try {
        const sync = await syncDiscordMember({
          guildId,
          botToken,
          userId: payload.discordId,
          nickname: payload.mafiaName,
          turtleRoleIds,
          crewRoleIds,
        });

        discordResult = {
          ...sync,
          turtleRoleIds,
          crewRoleIds,
        };
      } catch (e: unknown) {
        discordResult = {
          ok: false,
          error: (e as any)?.message ?? "Discord sync failed",
          turtleRoleIds,
          crewRoleIds,
        };
      }
    }
  }

  // 3) Send welcome message to Discord for NEW signups (not updates)
  let welcomeResult: unknown = null;
  if (isNewSignup && payload.discordId) {
    welcomeResult = await sendWelcomeMessage({
      discordId: payload.discordId,
      memberId: payload.memberId,
      mafiaName: payload.mafiaName,
      city: payload.city,
      topping: payload.topping,
      mafiaMovie: payload.resolvedMovieTitle || payload.mafiaMovieTitle,
      turtles: payload.turtles,
      crews: payload.crews,
    });
  }

  return NextResponse.json({ ok: true, discord: discordResult, sheets: parsed, welcome: welcomeResult });
};

export const POST = withErrorHandling(POST_HANDLER);
