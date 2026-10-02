/**
 * Single source of truth for every Google Sheet the app reads or references.
 *
 * Each ID can be overridden with an environment variable so a staging / preview
 * deployment can point at copies of the production sheets without a code
 * change. Empty or whitespace-only env values fall back to the default.
 *
 * Server-side only: do not import from client components.
 */

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** Main PizzaDAO members database ("Crew" tab). */
const DEFAULT_MEMBERS_SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";

export const SHEET_IDS = {
  /** Members database (Crew tab): IDs, names, Discord IDs, crews, turtles, wallets. */
  members: envOr("MEMBERS_SHEET_ID", DEFAULT_MEMBERS_SHEET_ID),
  /** Crew Mappings config: crew list, Discord roles, channels, call times, crew sheets. */
  crewMappings: envOr("CREW_MAPPINGS_SHEET_ID", "19itGq86BRQTVehKhtRFKwK8gZqjsUQ_bG5cuVmem9HU"),
  /** Community Call sheet (its "Attendance" tab links to the daily attendance sheets). */
  communityCall: envOr("COMMUNITY_CALL_SHEET_ID", "1S7WGjHpMcxw8erA3cBevoGlVX_G253AMGg1kNAU_53o"),
  /** Whitelisted POAP event IDs. */
  poapWhitelist: envOr("POAP_WHITELIST_SHEET_ID", "1UsQA1Jqm4gCb1qMwWf7i_k0eNsi5EofyOjijmGig3Jc"),
  /** NFT collections shown on profiles / leaderboard (chain, contract, name, order). */
  nftContracts: envOr("NFT_CONTRACTS_SHEET_ID", "1I9Sjj5kNQOushVbYGSnG668tMOAz0SJ3L8StaCG5r0I"),
  /** Manuals index (title, crew, status, author, ...). */
  manuals: envOr("MANUALS_SHEET_ID", "1KDAzz8qQubCaFiplWaUFBgCZlHR_mIA0IJHKNqgK5hg"),
  /** Discord webhook URLs keyed by channel name (read through the Sheets API). */
  discordWebhooks: envOr("DISCORD_WEBHOOKS_SHEET_ID", "1bSLN2mL1K-qr3nLiURVjhm31Zxn0J3ta1Pq0txlXsPI"),
  /**
   * Spreadsheet whose "Crews" tab holds the Community Call announcement block
   * (Announce? / Last Sent: / Last Error: + Announcement table) used by /api/announce.
   * Defaults to the production members sheet (not to an overridden `members`
   * value) so a staging override never re-targets the real announcement.
   */
  announce: envOr("ANNOUNCE_SHEET_ID", DEFAULT_MEMBERS_SHEET_ID),
} as const;

export type SheetKey = keyof typeof SHEET_IDS;

/** Tab names used with the sheets above. */
export const SHEET_TABS = {
  members: "Crew",
  crewMappings: "Crew Mappings",
} as const;
