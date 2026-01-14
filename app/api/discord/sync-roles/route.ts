// app/api/discord/sync-roles/route.ts
import { TURTLE_ROLE_IDS } from "@/app/ui/constants"; // adjust path if needed

const API_BASE = "https://discord.com/api/v10";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function discordFetch(path: string, init: RequestInit = {}) {
  const token = mustEnv("DISCORD_BOT_TOKEN");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  // 204 has no body
  if (res.status === 204) return { ok: true, status: 204, json: null as any };

  let json: any = null;
  try {
    json = await res.json();
  } catch {}

  if (!res.ok) {
    const msg = json?.message || `Discord API error ${res.status}`;
    throw new Error(msg);
  }

  return { ok: true, status: res.status, json };
}

export async function POST(req: Request) {
  try {
    const { discordId, turtleKeys, mode } = (await req.json()) as {
      discordId: string;
      turtleKeys: string[];
      // mode: "add-only" (default) or "replace" (remove unselected turtle roles)
      mode?: "add-only" | "replace";
    };

    if (!discordId) return Response.json({ error: "Missing discordId" }, { status: 400 });
    const guildId = mustEnv("DISCORD_GUILD_ID");

    const selectedRoleIds = new Set(
      (turtleKeys || [])
        .map((k) => TURTLE_ROLE_IDS[String(k || "").toUpperCase()])
        .filter(Boolean)
    );

    // Optional: replace mode removes turtle roles not selected
    if (mode === "replace") {
      const member = await discordFetch(`/guilds/${guildId}/members/${discordId}`, { method: "GET" });
      const currentRoles: string[] = member.json?.roles || [];

      const managedRoleIds = new Set(Object.values(TURTLE_ROLE_IDS));
      const toRemove = currentRoles.filter((r) => managedRoleIds.has(r) && !selectedRoleIds.has(r));

      for (const roleId of toRemove) {
        await discordFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, { method: "DELETE" });
      }
    }

    // Add selected roles
    for (const roleId of selectedRoleIds) {
      await discordFetch(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, { method: "PUT" });
    }

    return Response.json({ ok: true, added: Array.from(selectedRoleIds) });
  } catch (e: unknown) {
    return Response.json({ error: (e as any)?.message || "Failed to sync roles" }, { status: 500 });
  }
}
