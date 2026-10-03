/**
 * Slash commands served by /api/discord/interactions, and their registration
 * payloads (scripts/discord/register-commands.mjs PUTs these as guild
 * commands). Only commands with a handler are listed; /collect-income, /pay
 * and /leaderboard are specced in plans/unbelievaboat-replacement.md.
 */

// Discord application command option types
const USER = 6

export const PEP_COMMANDS = [
  {
    name: 'balance',
    description: 'Show your $PEP balance (or another member’s)',
    options: [{ type: USER, name: 'member', description: 'Member to look up', required: false }],
    dm_permission: false,
  },
  {
    name: 'work',
    description: 'Work a shift for some $PEP (30s cooldown)',
    dm_permission: false,
  },
] as const

export type PepCommandName = (typeof PEP_COMMANDS)[number]['name']

// Interaction + response types (subset)
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4 } as const
export const EPHEMERAL = 64
