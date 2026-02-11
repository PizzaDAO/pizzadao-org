/**
 * Low-level Discord API wrapper
 */
export async function discordFetch(path: string, init: RequestInit) {
  const base = "https://discord.com/api/v10";
  const res = await fetch(base + path, init);
  const text = await res.text();

  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch { }

  return { res, json, text };
}

/**
 * Sync Discord member roles and nickname.
 *
 * Region roles are "exclusive": at most one region role at a time.
 * When a new region role is provided, all existing region roles
 * (from allRegionRoleIds) are removed before the new one is added.
 */
export async function syncDiscordMember(opts: {
  guildId: string;
  botToken: string;
  userId: string;
  nickname?: string;
  turtleRoleIds: string[];
  crewRoleIds: string[];
  /** The single region role to assign (if any). */
  regionRoleId?: string;
  /** The full set of managed region role IDs, so old ones can be stripped. */
  allRegionRoleIds?: Set<string>;
}) {
  const {
    guildId,
    botToken,
    userId,
    nickname,
    turtleRoleIds,
    crewRoleIds,
    regionRoleId,
    allRegionRoleIds,
  } = opts;

  // 1. GET current member roles
  const member = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!member.res.ok) {
    throw new Error(
      `Discord GET member failed (${member.res.status}): ${(member.json as any)?.message ?? member.text}`
    );
  }

  const currentRoles: string[] = Array.isArray((member.json as any)?.roles)
    ? (member.json as any).roles
    : [];

  // 2. Build the next role set
  //    Start with current roles, strip any old region roles, then add turtle + crew + new region
  let baseRoles = currentRoles;

  if (allRegionRoleIds && allRegionRoleIds.size > 0) {
    // Remove all managed region roles from current set
    baseRoles = currentRoles.filter((r) => !allRegionRoleIds.has(r));
  }

  const rolesToAdd = [...turtleRoleIds, ...crewRoleIds];
  if (regionRoleId) {
    rolesToAdd.push(regionRoleId);
  }

  const nextRoles = Array.from(new Set([...baseRoles, ...rolesToAdd].map(String)));

  // 3. PATCH member
  const body: { roles: string[]; nick?: string } = { roles: nextRoles };
  if (nickname) body.nick = nickname.slice(0, 32);

  const patch = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!patch.res.ok) {
    const msg = (patch.json as any)?.message ?? patch.text;
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
