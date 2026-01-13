import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";

export const runtime = "nodejs";

// --- Fetch member data by Discord ID ---
async function fetchMemberByDiscordId(discordId: string) {
  const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
  const TAB_NAME = "Crew";

  function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("GViz: Unexpected response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
    TAB_NAME
  )}&tqx=out:json&headers=0`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch sheet");
  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerVals: string[] = [];
  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
    const hasName = rowVals.includes("name");
    const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
    if (hasName && hasStatus) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error("Header row not found");

  const headerMap = new Map<string, number>();
  headerVals.forEach((h, i) => headerMap.set(h.trim().toLowerCase(), i));

  // Find columns
  let idxId = headerMap.get("id") ?? headerMap.get("member id") ?? 0;
  const idxDiscord = headerMap.get("discordid") ?? headerMap.get("discord id") ?? headerMap.get("discord");
  const idxName = headerMap.get("name") ?? -1;
  const idxCrews = headerMap.get("crews") ?? -1;
  const idxTurtles = headerMap.get("turtles") ?? headerMap.get("turtle") ?? -1;

  if (idxDiscord == null) return null;

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const rowDiscord = String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim();
    if (rowDiscord === discordId) {
      return {
        memberId: String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim(),
        name: idxName >= 0 ? String(cells[idxName]?.v ?? cells[idxName]?.f ?? "").trim() : "",
        crews: idxCrews >= 0 ? String(cells[idxCrews]?.v ?? cells[idxCrews]?.f ?? "").trim() : "",
        turtles: idxTurtles >= 0 ? String(cells[idxTurtles]?.v ?? cells[idxTurtles]?.f ?? "").trim() : "",
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
async function fetchWithRedirect(url: string, payload: any, maxRedirects = 3): Promise<{ status: number; text: string }> {
  // First request is POST with the payload
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "manual",
  });

  // If not a redirect, return directly
  if (res.status !== 302 && res.status !== 301) {
    const text = await res.text();
    return { status: res.status, text };
  }

  // Follow redirects with GET (Apps Script redirect pattern)
  let currentUrl: string | null = res.headers.get("location");
  if (!currentUrl) {
    return { status: res.status, text: "Redirect without location" };
  }

  for (let i = 0; i < maxRedirects; i++) {
    const redirectRes: Response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
    });

    if (redirectRes.status === 302 || redirectRes.status === 301) {
      const location = redirectRes.headers.get("location");
      if (!location) {
        return { status: redirectRes.status, text: "Redirect without location" };
      }
      currentUrl = location;
      continue;
    }

    const text = await redirectRes.text();
    return { status: redirectRes.status, text };
  }
  return { status: 500, text: "Too many redirects" };
}

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
      ? member.crews.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
      : [];

    // Calculate new crews
    let newCrews: string[];
    if (action === "join") {
      if (currentCrews.includes(crewId.toLowerCase())) {
        return NextResponse.json({ error: "Already in this crew" }, { status: 400 });
      }
      newCrews = [...currentCrews, crewId.toLowerCase()];
    } else {
      if (!currentCrews.includes(crewId.toLowerCase())) {
        return NextResponse.json({ error: "Not in this crew" }, { status: 400 });
      }
      newCrews = currentCrews.filter((c) => c !== crewId.toLowerCase());
    }

    // Update sheet
    await updateCrewsInSheet(member.memberId, newCrews);

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
        } catch (e: any) {
          discordResult = { ok: false, error: e.message };
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
    console.error("[join-crew] Error:", err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
