/**
 * Slash commands served by /api/discord/interactions, and their registration
 * payloads (scripts/discord/register-commands.mjs PUTs these as guild
 * commands). Only commands with a handler are listed.
 *
 * /rob, /peace and the games are registered like the rest but answer "not
 * enabled yet" until PEP_ROB_ENABLED=1 / PEP_GAMES_ENABLED=1.
 *
 * /add-money and /remove-money are admin-only twice over: default_member_permissions
 * "0" hides them from everyone without the Administrator permission (a server
 * admin can allow more roles under Server Settings > Integrations), and the
 * handler re-checks member.roles against ADMIN_ROLE_IDS.
 */

// Discord application command option types
const STRING = 3
const INTEGER = 4
const BOOLEAN = 5
const USER = 6

/** Only members with Administrator see the command until a server admin allows more roles. */
const ADMIN_ONLY = '0'

const bet = { type: INTEGER, name: 'bet', description: 'How much $PEP to bet', required: true, min_value: 1 } as const

// Reason length matches ADMIN_REASON_MIN/MAX in app/lib/pep-admin.ts (the handler enforces it too).
const adminMoneyOptions = (verb: string) =>
  [
    { type: USER, name: 'member', description: `Member to ${verb}`, required: true },
    { type: INTEGER, name: 'amount', description: 'How much $PEP', required: true, min_value: 1 },
    { type: STRING, name: 'reason', description: 'Why (shown publicly and logged)', required: true, min_length: 3, max_length: 200 },
  ] as const

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
  {
    name: 'collect-income',
    description: 'Collect the daily $PEP income from your roles',
    dm_permission: false,
  },
  {
    name: 'pay',
    description: 'Send $PEP to another member',
    options: [
      { type: USER, name: 'member', description: 'Who to pay', required: true },
      { type: INTEGER, name: 'amount', description: 'How much $PEP', required: true, min_value: 1 },
    ],
    dm_permission: false,
  },
  {
    name: 'leaderboard',
    description: 'Top 10 $PEP wallets',
    dm_permission: false,
  },
  {
    name: 'rob',
    description: 'Try to rob a member (you risk a fine)',
    options: [{ type: USER, name: 'member', description: 'Who to rob', required: true }],
    dm_permission: false,
  },
  {
    name: 'peace',
    description: 'Peace mode: you can’t rob and can’t be robbed. No option = show status',
    options: [{ type: BOOLEAN, name: 'enabled', description: 'Turn peace mode on or off', required: false }],
    dm_permission: false,
  },
  {
    name: 'blackjack',
    description: 'Play a hand of blackjack (pays 3:2)',
    options: [bet],
    dm_permission: false,
  },
  {
    name: 'roulette',
    description: 'Spin the wheel: red/black/even/odd pay 2x, a number pays 36x',
    options: [
      bet,
      { type: STRING, name: 'space', description: 'red, black, even, odd, or a number 0-36', required: true, max_length: 5 },
    ],
    dm_permission: false,
  },
  {
    name: 'slots',
    description: 'Spin the slot machine',
    options: [bet],
    dm_permission: false,
  },
  {
    name: 'shop',
    description: 'List the items in the $PEP shop',
    dm_permission: false,
  },
  {
    name: 'buy',
    description: 'Buy an item from the $PEP shop',
    options: [
      { type: STRING, name: 'item', description: 'Item to buy', required: true, autocomplete: true },
      { type: INTEGER, name: 'quantity', description: 'How many (default 1)', required: false, min_value: 1, max_value: 100 },
    ],
    dm_permission: false,
  },
  {
    name: 'add-money',
    description: 'Admin: give $PEP to a member',
    options: adminMoneyOptions('give $PEP to'),
    dm_permission: false,
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: 'remove-money',
    description: 'Admin: take $PEP from a member (never below 0)',
    options: adminMoneyOptions('take $PEP from'),
    dm_permission: false,
    default_member_permissions: ADMIN_ONLY,
  },
] as const

export type PepCommandName = (typeof PEP_COMMANDS)[number]['name']

// Interaction + response types (subset)
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, AUTOCOMPLETE: 4 } as const
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, UPDATE_MESSAGE: 7, AUTOCOMPLETE_RESULT: 8 } as const
export const EPHEMERAL = 64
