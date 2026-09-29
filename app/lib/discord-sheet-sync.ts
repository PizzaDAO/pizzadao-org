// app/lib/discord-sheet-sync.ts
// Pull a user's Discord roles into their Crew sheet row and record role-grant
// activity events. Server-side only.
//
// SECURITY: the target row is resolved ONLY from the Crew sheet by discordId.
// Callers cannot pass a memberId: doing so previously let anyone re-point
// another member's row to their own Discord account.
import { ROLE_ID_TO_TURTLE } from "@/app/ui/constants";
import { writeToSheet } from "@/app/api/profile/route";
import { prisma } from "@/app/lib/db";
import { getSheetData, type MemberSheetData } from "@/app/lib/sheets/member-repository";

const BASE_DISCORD_API = "https://discord.com/api/v10";

async function fetchDiscordMember(guildId: string, userId: string, botToken: string) {
  const res = await fetch(`${BASE_DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord API error (${res.status})`);
  }
  return res.json();
}

async function findSheetRowByDiscordId(
  discordId: string,
): Promise<{ memberId: string; row: MemberSheetData } | null> {
  const cache = await getSheetData();
  const memberId = cache.discordToMember.get(discordId);
  if (!memberId) return null;
  const idx = cache.memberToIdx.get(memberId);
  if (idx === undefined) return null;
  return { memberId, row: cache.rows[idx] };
}

export interface DiscordSheetSyncResult {
  ok: true;
  memberId: string | null;
  turtles: string[];
  otherRoles: string[];
  /** true when no Crew row is linked to this Discord ID (nothing written to the sheet) */
  skippedSheet: boolean;
  writeRes?: unknown;
}

/**
 * Sync the Discord roles of `discordId` into the Crew sheet row already linked
 * to that Discord ID. Never links a new row: linking happens only via the
 * onboarding claim flows (/api/claim-member, /api/auto-claim).
 */
export async function syncDiscordRolesToSheet(
  discordId: string,
  fallbackName?: string,
): Promise<DiscordSheetSyncResult> {
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (!guildId || !botToken || !secret) {
    throw new Error("Missing env vars");
  }

  // 1. Fetch from Discord
  const discordMember = await fetchDiscordMember(guildId, discordId, botToken);
  const discordRoleIds: string[] = discordMember.roles || [];

  // 2. Map roles (turtles vs other named roles)
  const guildRolesMap = new Map<string, string>(); // ID -> Name
  try {
    const rolesRes = await fetch(`${BASE_DISCORD_API}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (rolesRes.ok) {
      const rolesData = (await rolesRes.json()) as Array<{ id: string; name: string }>;
      rolesData.forEach((r) => guildRolesMap.set(r.id, r.name));
    }
  } catch {
    // role names are best-effort
  }

  const discordTurtles: string[] = [];
  const otherRoleNames: string[] = [];
  discordRoleIds.forEach((rId) => {
    const turtleName = ROLE_ID_TO_TURTLE[rId];
    if (turtleName) {
      discordTurtles.push(turtleName);
    } else {
      const name = guildRolesMap.get(rId);
      if (name && name !== "@everyone") otherRoleNames.push(name);
    }
  });

  // 3. Resolve the row strictly by Discord ID
  const found = await findSheetRowByDiscordId(discordId);
  const memberId = found?.memberId ?? null;

  const existingTurtles = found?.row?.Turtles
    ? String(found.row.Turtles).split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // 4. Merge & dedup (preserve manual sheet entries)
  const finalRoles = Array.from(new Set([...existingTurtles, ...discordTurtles, ...otherRoleNames]));

  // 5. Write back to the sheet (only if the row is already linked to this Discord ID)
  let writeRes: unknown = undefined;
  if (found) {
    const finalMafiaName =
      String(found.row.Name || "").trim() || fallbackName || discordMember.user?.username || "Unknown";
    writeRes = await writeToSheet({
      secret,
      source: "discord-sync",
      discordId,
      memberId,
      mafiaName: finalMafiaName,
      turtles: finalRoles,
    });
  }

  // --- Activity feed: log role grants ---
  // Diff the freshly-pulled Discord role set against the last-known snapshot in
  // User.roles; any new role id is logged as a `role_granted` event (idempotent
  // via the unique (discordId, roleId) constraint). Then refresh the snapshot.
  try {
    const existing = await prisma.user.findUnique({
      where: { id: discordId },
      select: { roles: true },
    });
    const previousRoles = new Set(existing?.roles ?? []);
    const newRoleIds = discordRoleIds.filter((r) => !previousRoles.has(r));

    if (newRoleIds.length > 0) {
      await Promise.allSettled(
        newRoleIds.map((roleId) =>
          prisma.roleGrantEvent.upsert({
            where: { discordId_roleId: { discordId, roleId } },
            update: {},
            create: {
              discordId,
              memberId,
              roleId,
              roleName: guildRolesMap.get(roleId) ?? roleId,
            },
          }),
        ),
      );
    }

    await prisma.user.upsert({
      where: { id: discordId },
      update: { roles: discordRoleIds },
      create: { id: discordId, roles: discordRoleIds },
    });
  } catch (err) {
    console.error("[discord-sheet-sync] failed to log role grants (non-blocking):", err);
  }

  return {
    ok: true,
    memberId,
    turtles: finalRoles,
    otherRoles: otherRoleNames,
    skippedSheet: !found,
    writeRes,
  };
}
