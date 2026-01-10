// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";
import { getSession } from "@/app/lib/session";
import { getDiscordTurtleRoles, mergeTurtles, parseTurtlesFromSheet } from "@/app/lib/discord-roles";
import { sendWelcomeMessage } from "@/app/lib/discord-webhook";

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

/**
 * Minimal GViz reader to find the DiscordID for a given memberId.
 * Used to enforce "only the owner can update their profile".
 */
async function fetchMemberRowById(memberId: string) {
  const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
  const TAB_NAME = "Crew";

  function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("GViz: Unexpected response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  // headers=0 ensures the header row is included in the response
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
    TAB_NAME
  )}&tqx=out:json&headers=0`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch sheet");
  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // header hunter (same logic as member-lookup)
  let headerRowIdx = -1;
  let headerVals: string[] = [];
  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
    const hasName = rowVals.includes("name");
    const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
    const hasCity = rowVals.includes("city") || rowVals.includes("crews");
    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error("Header row not found");

  const headerMap = new Map<string, number>();
  headerVals.forEach((h, i) => headerMap.set(h.trim().toLowerCase(), i));

  // Find ID column, fallback to column 0 if not found (matches member-lookup behavior)
  let idxId = headerMap.get("id") ?? headerMap.get("member id") ?? headerMap.get("memberid");
  if (idxId == null) idxId = 0; // fallback to column A

  // DiscordID column variants
  const idxDiscord =
    headerMap.get("discordid") ??
    headerMap.get("discord id") ??
    headerMap.get("discord") ??
    headerMap.get("discord user id");

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const idVal = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
    if (idVal && idVal === memberId) {
      const discordVal =
        idxDiscord != null ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim() : "";
      return { discordId: discordVal };
    }
  }

  return null;
}

async function discordFetch(path: string, init: RequestInit) {
  const base = "https://discord.com/api/v10";
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { }
  return { res, json, text };
}

async function syncDiscordMember(opts: {
  guildId: string;
  botToken: string;
  userId: string;
  nickname?: string;
  turtleRoleIds: string[];
  crewRoleIds: string[];
}) {
  const { guildId, botToken, userId, nickname, turtleRoleIds, crewRoleIds } = opts;

  // 1) Read current member roles
  const member = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!member.res.ok) {
    throw new Error(
      `Discord GET member failed (${member.res.status}): ${member.json?.message ?? member.text}`
    );
  }

  const currentRoles: string[] = Array.isArray(member.json?.roles) ? member.json.roles : [];

  // 2) Replace only turtle roles, keep all other roles
  const ALL_TURTLE_ROLE_IDS = new Set(Object.values(TURTLE_ROLE_IDS).map(String));
  const kept = currentRoles.filter((r) => !ALL_TURTLE_ROLE_IDS.has(String(r)));

  const nextRoles = Array.from(new Set([...kept, ...turtleRoleIds, ...crewRoleIds].map(String)));

  // 3) PATCH member: nick + roles
  const body: any = { roles: nextRoles };
  if (nickname) body.nick = nickname.slice(0, 32); // Discord nickname limit

  const patch = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!patch.res.ok) {
    const msg = patch.json?.message ?? patch.text;
    if (patch.res.status === 403) {
      throw new Error(
        `Discord PATCH member failed (403): Missing Permissions. ` +
        `Ensure the bot role has Manage Roles + Manage Nicknames, and that the bot's highest role is ABOVE ` +
        `every role it is trying to assign. Discord message: ${msg}`
      );
    }
    throw new Error(`Discord PATCH member failed (${patch.res.status}): ${msg}`);
  }

  return { ok: true, rolesSet: nextRoles.length };
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
  const data = (await res.json()) as CrewMappingsResponse | any;
  if (!res.ok) throw new Error(data?.error || "Failed to load crew mappings (server)");

  const crews: CrewOption[] = Array.isArray(data?.crews) ? data.crews : [];
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

// --- main handler ---
export async function writeToSheet(payload: any) {
  const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (!url) throw new Error("Missing Sheets webapp env vars");

  console.log("[writeToSheet] Calling:", url);
  const sheetRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await sheetRes.text();
  console.log("[writeToSheet] Response status:", sheetRes.status, "text length:", text.length);
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch { }

  if (!sheetRes.ok || parsed?.ok === false || (parsed?.crewSync && parsed.crewSync.ok === false)) {
    console.error("[writeToSheet] Error:", parsed?.crewSync?.error ?? parsed?.details ?? parsed ?? text);
    throw new Error(JSON.stringify(parsed?.crewSync?.error ?? parsed?.details ?? parsed ?? text));
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

  const candidates = [
    TURTLE_ROLE_IDS[upper as keyof typeof TURTLE_ROLE_IDS],
    (TURTLE_ROLE_IDS as any)[lower],
    (TURTLE_ROLE_IDS as any)[title],
    (TURTLE_ROLE_IDS as any)[`${normalizeTurtleKey(raw)}_role_id`],
    (TURTLE_ROLE_IDS as any)[`${upper}_ROLE_ID`],
  ].filter(Boolean);

  return candidates.length ? String(candidates[0]) : null;
}

export async function POST(req: Request) {
  try {
    const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
    if (!url || !secret) {
      return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
    }

    const session = await getSession();
    console.log("[profile] Session check:", { hasSession: !!session, discordId: session?.discordId });
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    console.log("[profile] Received body:", {
      mafiaName: body.mafiaName,
      city: body.city,
      topping: body.topping,
      crews: body.crews,
      turtles: body.turtles,
      memberId: body.memberId,
    });

    // Get submitted turtles from form
    const submittedTurtles = Array.isArray(body.turtles)
      ? body.turtles.map((x: any) => clampStr(x, 40)).filter(Boolean)
      : [];

    // Fetch Discord turtle roles and merge with submitted (adds any Discord roles not already submitted)
    const discordTurtles = await getDiscordTurtleRoles(session.discordId);
    const turtlesArr = mergeTurtles(submittedTurtles, discordTurtles);

    console.log("[profile] Turtle sync:", {
      submitted: submittedTurtles,
      discord: discordTurtles,
      merged: turtlesArr,
    });

    const crewsArr = Array.isArray(body.crews)
      ? body.crews.map((x: any) => clampStr(x, 40)).filter(Boolean)
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
      console.log("[profile] Validation failed: missing mafiaName");
      return NextResponse.json(
        {
          error: "Missing required fields.",
          missing: {
            mafiaName: !payload.mafiaName,
          },
        },
        { status: 400 }
      );
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
      const row = await fetchMemberRowById(payload.memberId);

      if (row) {
        // Row exists - this is an UPDATE, verify ownership
        isNewSignup = false;
        const sheetDiscord = String(row.discordId || "").trim();
        if (!sheetDiscord) {
          return NextResponse.json(
            { error: "Member is not claimed yet. Use the claim flow first." },
            { status: 403 }
          );
        }

        if (sheetDiscord !== payload.discordId) {
          return NextResponse.json({ error: "Forbidden: cannot edit another member" }, { status: 403 });
        }

        // Optional safety: prevent blank-overwrite updates
        const hasAnyUpdateField =
          Boolean(payload.city) || payload.turtles.length > 0 || payload.crews.length > 0 || Boolean(payload.topping);
        if (!hasAnyUpdateField) {
          return NextResponse.json(
            { error: "No update fields provided." },
            { status: 400 }
          );
        }
      }
      // If row doesn't exist, it's a NEW signup with a chosen memberId - allow it to proceed
    }

    // 1) Write to Sheets
    let parsed: any;
    try {
      console.log("[profile] Writing to sheet with payload keys:", Object.keys(payload));
      parsed = await writeToSheet(payload);
      console.log("[profile] Sheet write result:", parsed);
    } catch (e: any) {
      console.error("[profile] Sheet write failed:", e?.message ?? String(e));
      return NextResponse.json(
        {
          error: "Failed to save profile",
          details: e?.message ?? String(e),
        },
        { status: 502 }
      );
    }

    // 2) Sync Discord
    let discordResult: any = null;

    if (payload.discordId) {
      const guildId = process.env.DISCORD_GUILD_ID;
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!guildId || !botToken) {
        discordResult = { ok: false, error: "Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN" };
      } else {
        // Turtle role IDs (payload.turtles are like "Leonardo", "Raphael", ...)
        const turtleRoleIds = payload.turtles
          .map((t: any) => resolveTurtleRoleId(String(t)))
          .filter(Boolean) as string[];

        // Crew role IDs from crew mappings table (column "role")
        let crewRoleIds: string[] = [];
        try {
          crewRoleIds = await fetchCrewRoleIds(req, payload.crews);
        } catch (e: any) {
          crewRoleIds = [];
          discordResult = { ok: false, error: `Crew role lookup failed: ${e?.message ?? "unknown"}` };
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
        } catch (e: any) {
          discordResult = {
            ok: false,
            error: e?.message ?? "Discord sync failed",
            turtleRoleIds,
            crewRoleIds,
          };
        }
      }
    }

    // 3) Send welcome message to Discord for NEW signups (not updates)
    let welcomeResult: any = null;
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
