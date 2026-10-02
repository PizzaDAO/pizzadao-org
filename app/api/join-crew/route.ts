import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import {
  cellText,
  getMembersSheet,
  invalidateMembersCache,
  memberIdColumn,
  membersColumn,
} from "@/app/lib/sheets/member-repository";
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";
import { crewIdToLabel, normalizeCrewId } from "@/app/lib/crew-labels";

export const runtime = "nodejs";

// --- Fetch member data by Discord ID ---
// Uncached on purpose: the current crew list read here is rewritten below
// (join/leave), so a stale row could silently drop a crew.
async function fetchMemberByDiscordId(discordId: string) {
  const sheet = await getMembersSheet({ fresh: true });

  const idxId = memberIdColumn(sheet);
  const idxDiscord = membersColumn(sheet, ["discordid", "discord id", "discord"]);
  const idxName = membersColumn(sheet, ["name"]);
  const idxCrews = membersColumn(sheet, ["crews"]);
  const idxTurtles = membersColumn(sheet, ["turtles", "turtle"]);

  if (idxDiscord == null) return null;

  for (const row of sheet.rows) {
    const cells = row?.c || [];
    if (cellText(cells[idxDiscord]) === discordId) {
      return {
        memberId: cellText(cells[idxId]),
        name: idxName != null ? cellText(cells[idxName]) : "",
        crews: idxCrews != null ? cellText(cells[idxCrews]) : "",
        turtles: idxTurtles != null ? cellText(cells[idxTurtles]) : "",
      };
    }
  }

  return null;
}

// --- Crew role ID lookup ---
type CrewOption = { id: string; role?: string };

async function fetchCrewRoleId(req: Request, crewId: string): Promise<string | null> {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  const res = await fetch(`${base}/api/crew-mappings`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) return null;

  const crews: CrewOption[] = Array.isArray(data?.crews) ? data.crews : [];
  const crew = crews.find((c) => c.id?.toLowerCase() === crewId.toLowerCase());

  if (!crew?.role) return null;

  // Extract role ID from mention format <@&123456789>
  const match = crew.role.match(/^<@&(\d+)>$/) || crew.role.match(/^(\d+)$/);
  return match ? match[1] : null;
}

// --- Discord API helpers ---
async function discordFetch(path: string, init: RequestInit) {
  const base = "https://discord.com/api/v10";
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}

async function updateDiscordRoles(opts: {
  guildId: string;
  botToken: string;
  userId: string;
  addRoleIds: string[];
  removeRoleIds: string[];
}) {
  const { guildId, botToken, userId, addRoleIds, removeRoleIds } = opts;

  // Get current roles
  const member = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!member.res.ok) {
    throw new Error(`Discord GET member failed: ${member.json?.message ?? member.text}`);
  }

  const currentRoles: string[] = Array.isArray(member.json?.roles) ? member.json.roles : [];

  // Calculate new roles
  let nextRoles = currentRoles.filter((r) => !removeRoleIds.includes(r));
  nextRoles = Array.from(new Set([...nextRoles, ...addRoleIds]));

  // Update roles
  const patch = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roles: nextRoles }),
  });

  if (!patch.res.ok) {
    throw new Error(`Discord PATCH failed: ${patch.json?.message ?? patch.text}`);
  }

  return { ok: true };
}

/**
 * Fetch with redirect handling for Apps Script.
 * The redirect URL should be fetched with GET to retrieve the response.
 */

// --- Write to sheet ---
async function updateCrewsInSheet(memberId: string, crews: string[]) {
  const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (!url || !secret) throw new Error("Missing sheet config");

  const payload = {
    secret,
    memberId,
    crews,
    source: "join-crew",
  };

  const { status, text } = await fetchWithRedirect(url, payload);

  if (status < 200 || status >= 300) {
    throw new Error(`Sheet update failed: ${text}`);
  }

  // The member's crews changed: expire cached members-sheet reads.
  invalidateMembersCache();

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

// --- Main handler ---
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { crewId, action } = body;

    if (!crewId || !["join", "leave"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Get member data
    const member = await fetchMemberByDiscordId(session.discordId);
    if (!member) {
      return NextResponse.json({ error: "Member not found. Please complete onboarding first." }, { status: 404 });
    }

    // Parse current crews
    const currentCrews = member.crews
      ? member.crews.split(",").map((c) => normalizeCrewId(c)).filter(Boolean)
      : [];

    // Calculate new crews
    let newCrews: string[];
    if (action === "join") {
      if (currentCrews.includes(normalizeCrewId(crewId))) {
        return NextResponse.json({ error: "Already in this crew" }, { status: 400 });
      }
      newCrews = [...currentCrews, normalizeCrewId(crewId)];
    } else {
      if (!currentCrews.includes(normalizeCrewId(crewId))) {
        return NextResponse.json({ error: "Not in this crew" }, { status: 400 });
      }
      newCrews = currentCrews.filter((c) => c !== normalizeCrewId(crewId));
    }

    // Update sheet
    await updateCrewsInSheet(member.memberId, newCrews.map(crewIdToLabel));

    // Update Discord roles
    const guildId = process.env.DISCORD_GUILD_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    let discordResult: any = { ok: false, error: "Discord not configured" };

    if (guildId && botToken) {
      const roleId = await fetchCrewRoleId(req, crewId);

      if (roleId) {
        try {
          await updateDiscordRoles({
            guildId,
            botToken,
            userId: session.discordId,
            addRoleIds: action === "join" ? [roleId] : [],
            removeRoleIds: action === "leave" ? [roleId] : [],
          });
          discordResult = { ok: true, roleId };
        } catch (e: unknown) {
          discordResult = { ok: false, error: (e as any)?.message };
        }
      } else {
        discordResult = { ok: true, note: "No Discord role for this crew" };
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      crewId,
      newCrews,
      discord: discordResult,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
