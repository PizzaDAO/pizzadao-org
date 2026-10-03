/**
 * Slash commands served by /api/discord/interactions, and their registration
 * payloads (scripts/discord/register-commands.mjs PUTs these as guild
 * commands). Only commands with a handler are listed.
 *
 * The games are registered like the rest but answer "not enabled yet" until
 * PEP_GAMES_ENABLED=1.
 *
 * /add-money and /remove-money are visible to everyone (no
 * default_member_permissions, so Pepperoni Mafia holders without Administrator
 * can see them); the handler rejects anyone not holding an admin role
 * (ADMIN_ROLE_IDS, Pepperoni Mafia, PEP_ADMIN_ROLE_IDS / _NAMES, see
 * isPepAdmin). To hide them from others, set per-command role permissions in
 * Server Settings > Integrations > Pepperoni Bot.
 */

// Discord application command option types
const STRING = 3
const INTEGER = 4
const USER = 6

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
  },
  {
    name: 'remove-money',
    description: 'Admin: take $PEP from a member (never below 0)',
    options: adminMoneyOptions('take $PEP from'),
    dm_permission: false,
  },
  {
    // Deferred (type 5): the verifier run can exceed Discord's 3 s window,
    // so the reply is edited in via the interaction webhook afterwards.
    name: 'missions',
    description: 'Check your PizzaDAO missions: verifies what it can and shows your level',
    dm_permission: false,
  },
] as const

export type PepCommandName = (typeof PEP_COMMANDS)[number]['name']

// Interaction + response types (subset)
export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 } as const
export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  /** Ack a component click / modal submit now and edit the message later. */
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const
export const EPHEMERAL = 64
