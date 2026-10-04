// e2e/local/fixtures.cjs
//
// Synthetic test members for `npm run e2e:local`. They exist only in the
// locally served members sheet (see preload.cjs) and the throwaway Postgres.
// Discord IDs are fake (not real snowflakes of anyone) and member IDs sit far
// above the real sheet's range so they never collide with a real member.
"use strict";

const REAL_MEMBERS_SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const E2E_MEMBERS_SHEET_ID = "e2e-local-members";

/** Member with an incomplete profile (no crew, no wallet, no X). */
const NEW_MEMBER = {
  memberId: "990001",
  discordId: "100000000000990001",
  username: "e2e-new-member",
  name: "E2E Test Margherita",
  city: "Testville",
  crews: "",
  status: "Weekly",
};

/** Member whose profile is 100% complete (crew + wallet + X). Celebration not yet shown. */
const COMPLETE_MEMBER = {
  memberId: "990002",
  discordId: "100000000000990002",
  username: "e2e-complete-member",
  name: "E2E Test Quattro Formaggi",
  city: "Testville",
  crews: "Ops",
  status: "Daily",
  wallet: "0x000000000000000000000000000000000000e2e2",
  xUsername: "e2e_fake_x",
};

/**
 * Shop admin: holds the Pepperoni Mafia role, which may manage the shop
 * (/admin/shop, same rule as /add-money). Its roles come from the fake guild
 * member lookup in preload.cjs; every other Discord call stays blocked.
 */
const SHOP_ADMIN_MEMBER = {
  memberId: "990003",
  discordId: "100000000000990003",
  username: "e2e-shop-admin",
  name: "E2E Test Pepperoni",
  city: "Testville",
  crews: "",
  status: "Weekly",
  discordRoles: ["823266914834841610"], // Pepperoni Mafia (app/ui/constants.ts)
};

const MEMBERS = [NEW_MEMBER, COMPLETE_MEMBER, SHOP_ADMIN_MEMBER];

/**
 * In the (fake) guild but NOT in the members sheet, like the held L6/L7 role
 * holders from the mission backfill. The review panel must name them from
 * Discord (nickname), not show the raw ID.
 */
const DISCORD_ONLY_MEMBER = {
  discordId: "100000000000990009",
  username: "e2e-discord-only",
  name: "E2E Discord-only Diavola",
  discordRoles: ["823266914834841610"], // Pepperoni Mafia
};

/**
 * Dummy DISCORD_GUILD_ID for e2e:local. preload.cjs answers
 * GET discord.com/api/v10/guilds/<this>/members/<fixture discordId> locally
 * (with the fixture's discordRoles) so role-gated pages can be exercised.
 */
const FAKE_DISCORD_GUILD_ID = "e2e-local-guild";

const DEFAULT_HEADER = [null, "Status", "Name", "City", "Orgs", "Crews", "Skills", "Telegram", "ENS", "Turtles", "Region", "Notes", "DiscordID", "Wallet", "X"];

function cellLabel(cell) {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  return String(cell.f ?? cell.v ?? "");
}

/** Build fixture rows aligned to the live sheet's header row (gviz row or array). */
function rows(headerRow) {
  const header = headerRow?.c ? headerRow.c.map(cellLabel) : DEFAULT_HEADER.map((h) => h ?? "");
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  return MEMBERS.map((m) => {
    const byKey = {
      status: m.status,
      name: m.name,
      city: m.city,
      orgs: "PizzaDAO",
      crews: m.crews,
      skills: "Testing",
      turtles: "Leonardo",
      region: "North America",
      notes: "e2e:local synthetic member",
      discordid: m.discordId,
      wallet: m.wallet || "",
    };
    return header.map((h, i) => {
      if (i === 0) return Number(m.memberId); // ID column (blank header)
      return byKey[norm(h)] ?? "";
    });
  });
}

module.exports = {
  REAL_MEMBERS_SHEET_ID,
  E2E_MEMBERS_SHEET_ID,
  NEW_MEMBER,
  COMPLETE_MEMBER,
  SHOP_ADMIN_MEMBER,
  MEMBERS,
  DISCORD_ONLY_MEMBER,
  FAKE_DISCORD_GUILD_ID,
  TEST_MEMBER_ROWS: { header: DEFAULT_HEADER.map((h) => h ?? ""), rows },
};
