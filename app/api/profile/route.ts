// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";

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
  const ALL_TURTLE_ROLE_IDS = new Set(Object.values(TURTLE_ROLE_IDS));
  const kept = currentRoles.filter((r) => !ALL_TURTLE_ROLE_IDS.has(r));

  const nextRoles = Array.from(new Set([...kept, ...turtleRoleIds, ...crewRoleIds]));

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
    // Helpful hint for the exact error you got
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
export async function POST(req: Request) {
  try {
    const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
    if (!url || !secret) {
      return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
    }

    const body = await req.json();

    const turtlesArr = Array.isArray(body.turtles)
      ? body.turtles.map((x: any) => clampStr(x, 40)).filter(Boolean)
      : [];

    const crewsArr = Array.isArray(body.crews) ? body.crews.map((x: any) => clampStr(x, 40)).filter(Boolean) : [];

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
      memberId: clampStr(body.memberId ?? "", 20),

      discordId: clampStr(body.discordId ?? "", 64),
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
        memberId: clampStr(body.memberId ?? "", 20),
        discordId: clampStr(body.discordId ?? "", 64),
        discordJoined: clampBool(body.discordJoined),
      },
    };

    // Basic validation
    if (!payload.mafiaName || !payload.topping || !payload.mafiaMovieTitle || !payload.city || !payload.turtle) {
      return NextResponse.json(
        {
          error: "Missing required fields.",
          missing: {
            mafiaName: !payload.mafiaName,
            topping: !payload.topping,
            mafiaMovieTitle: !payload.mafiaMovieTitle,
            city: !payload.city,
            turtle: !payload.turtle,
          },
        },
        { status: 400 }
      );
    }

    // 1) Write to Sheets
    const sheetRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await sheetRes.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch { }

    if (!sheetRes.ok || parsed?.ok === false) {
      return NextResponse.json(
        { error: "Failed to save profile", details: parsed ?? text },
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
          .map((t: any) => TURTLE_ROLE_IDS[String(t).toUpperCase()] ?? null)
          .filter(Boolean) as string[];

        // Crew role IDs from crew mappings table (column "role")
        let crewRoleIds: string[] = [];
        try {
          crewRoleIds = await fetchCrewRoleIds(req, payload.crews);
        } catch (e: any) {
          // don't block; report
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

    return NextResponse.json({ ok: true, discord: discordResult });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
