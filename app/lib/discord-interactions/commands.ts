/**
 * Slash commands served by /api/discord/interactions, and their registration
 * payloads (scripts/discord/register-commands.mjs PUTs these as guild
 * commands). Only commands with a handler are listed.
 *
 * The games are registered like the rest but answer "not enabled yet" until
 * games.enabled on.
 *
 * /add-money and /remove-money are visible to everyone (no
 * default_member_permissions, so Pepperoni Mafia holders without Administrator
 * can see them); the handler rejects anyone not holding an admin role
 * (ADMIN_ROLE_IDS, Pepperoni Mafia, PEP_ADMIN_ROLE_IDS / _NAMES, see
 * isPepAdmin). To hide them from others, set per-command role permissions in
 * Server Settings > Integrations > Pepperoni Bot.
 */

// Discord application command option types
const SUB_COMMAND = 1
const STRING = 3
const INTEGER = 4
const BOOLEAN = 5
const USER = 6

const bet = { type: INTEGER, name: 'bet', description: 'How much $PEP to bet', required: true, min_value: 1 } as const

// Reason length matches ADMIN_REASON_MIN/MAX in app/lib/pep-admin.ts (the handler enforces it too).
const adminMoneyOptions = (verb: string) =>
  [
    { type: USER, name: 'member', description: `Member to ${verb}`, required: true },
    { type: INTEGER, name: 'amount', description: 'How much $PEP', required: true, min_value: 1 },
    { type: STRING, name: 'reason', description: 'Why (shown publicly and logged)', required: true, min_length: 3, max_length: 200 },
  ] as const

// Which live call a /metalhead subcommand means (default: the call whose voice channel chat it is typed in).
const callOption = { type: STRING, name: 'call', description: "Which live call (default: this channel's call)", required: false, autocomplete: true, max_length: 100 } as const

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
  {
    // Deferred and ephemeral (type 5, flags 64). Each answers "isn't enabled yet" until its setting
    // (discord.vouchCommandEnabled / levelCommandEnabled / profileCommandEnabled) is on.
    name: 'vouch',
    description: 'Vouch for another PizzaDAO member (only you see the reply)',
    options: [{ type: USER, name: 'member', description: 'Who to vouch for', required: true }],
    dm_permission: false,
  },
  {
    name: 'level',
    description: 'Your level and what you need for the next one (or another member’s level)',
    options: [{ type: USER, name: 'member', description: 'Member to look up (default: you)', required: false }],
    dm_permission: false,
  },
  {
    name: 'profile',
    description: 'Profile stats for you or another member (only you see the reply)',
    options: [{ type: USER, name: 'member', description: 'Member to look up (default: you)', required: false }],
    dm_permission: false,
  },
  {
    // Deferred and public (type 5): reads the crew's last call and tasks, then edits the reply in.
    // Answers "not enabled" until calls.progressReportEnabled.
    name: 'progress',
    description: 'Post last call\'s action items and open tasks for a crew (default: the call in progress)',
    options: [{ type: STRING, name: 'crew', description: 'Crew (default: the call that is running now)', required: false, autocomplete: true, max_length: 80 }],
    dm_permission: false,
  },
  {
    // Deferred and ephemeral: posts the "we're live" announcement once per call. Hosts, admins and the live host roles only.
    // Answers "not enabled" until calls.liveAnnounceCommandEnabled.
    name: 'live',
    description: 'Announce that the community call is live (Discord, Telegram) and get the X post text',
    options: [{ type: STRING, name: 'stream', description: 'X (Twitter) stream link to include', required: false, max_length: 300 }],
    dm_permission: false,
  },
  {
    // Deferred and ephemeral (type 5, flags 64): spoken call updates and their controls. Leads of the
    // call's crew, admins and live hosts only (checked in the handler); answers "not enabled" until
    // discord.metalheadCommandEnabled (and calls.updatesEnabled for the rest).
    name: 'metalhead',
    description: 'Spoken call updates: read them, or stop / pause / skip them',
    options: [
      { type: SUB_COMMAND, name: 'updates', description: 'Read the call updates now', options: [callOption] },
      { type: SUB_COMMAND, name: 'stop', description: 'Stop speaking and leave the call channel (the recording is not affected)', options: [callOption] },
      { type: SUB_COMMAND, name: 'pause', description: 'Pause the updates', options: [callOption] },
      { type: SUB_COMMAND, name: 'resume', description: 'Resume the updates', options: [callOption] },
      { type: SUB_COMMAND, name: 'skip', description: 'Skip to the next part of the updates', options: [callOption] },
      { type: SUB_COMMAND, name: 'script', description: 'Show what would be read (nothing is played)', options: [callOption] },
    ],
    dm_permission: false,
  },
  {
    // Deferred and ephemeral (type 5, flags 64): crew tasks (not bounties), the same claim rules as the
    // crew pages. Answers "not enabled" until discord.taskCommandEnabled.
    name: 'task',
    description: 'Crew tasks: list, sign up, see yours, drop or add one (only you see the reply)',
    options: [
      { type: SUB_COMMAND, name: 'list', description: 'Open crew tasks', options: [{ type: STRING, name: 'crew', description: 'Only this crew’s tasks', required: false, autocomplete: true, max_length: 80 }] },
      { type: SUB_COMMAND, name: 'claim', description: 'Sign up for an open crew task', options: [{ type: STRING, name: 'task', description: 'Which task (pick one from the list)', required: true, autocomplete: true, max_length: 100 }] },
      { type: SUB_COMMAND, name: 'mine', description: 'Crew tasks you lead' },
      { type: SUB_COMMAND, name: 'drop', description: 'Drop a task you lead', options: [{ type: STRING, name: 'task', description: 'Which task', required: true, autocomplete: true, max_length: 100 }] },
      {
        // Crew leads and admins only (checked in the deferred step); same writer as the crew page.
        type: SUB_COMMAND,
        name: 'add',
        description: 'Crew leads and admins: add a task to a crew',
        options: [
          { type: STRING, name: 'crew', description: 'Which crew', required: true, autocomplete: true, max_length: 80 },
          { type: STRING, name: 'task', description: 'What needs doing', required: true, min_length: 3, max_length: 300 },
          { type: STRING, name: 'priority', description: 'Priority (default: none)', required: false, choices: ['Top', 'High', 'Mid', 'Low'].map((v) => ({ name: v, value: v })) },
          { type: STRING, name: 'due', description: 'Due date, month first: 2026-12-05, 12/5 or Dec 5', required: false, max_length: 20 },
        ],
      },
    ],
    dm_permission: false,
  },
  {
    // Deferred (type 5). Answers "not enabled" until trivia.enabled is on (production only). start and skip are
    // admin only (checked by the handler, like /add-money). The answers themselves are typed in the trivia channel.
    name: 'trivia',
    description: 'Discord trivia: the leaderboard, report a bad question (admins can also start or skip a round)',
    options: [
      {
        type: SUB_COMMAND,
        name: 'leaderboard',
        description: 'Top trivia winners',
        options: [{ type: BOOLEAN, name: 'public', description: 'Show it to everyone in the channel (default: only you)', required: false }],
      },
      { type: SUB_COMMAND, name: 'start', description: 'Admins: start a trivia round now in the trivia channel' },
      { type: SUB_COMMAND, name: 'skip', description: 'Admins: cancel the open trivia round (no $PEP is paid)' },
      {
        type: SUB_COMMAND,
        name: 'report',
        description: 'Report the latest trivia question as bad (only you see the reply)',
        options: [{ type: STRING, name: 'reason', description: 'What is wrong with it (optional)', required: false, max_length: 200 }],
      },
    ],
    dm_permission: false,
  },
] as const

/**
 * /bounty is NOT registered (the owner turned it off): it is left out of PEP_COMMANDS so
 * register-commands.mjs does not bring it back. The handler and this definition stay, so re-adding
 * it is one line in PEP_COMMANDS.
 */
export const BOUNTY_COMMAND = {
  // Deferred and ephemeral (type 5, flags 64): open bounties and claiming, the same rules as the website.
  // Answers "not enabled" until discord.bountyCommandEnabled.
  name: 'bounty',
  description: 'Open bounties: see them, claim one, see yours or give one up (only you see the reply)',
  options: [
    { type: SUB_COMMAND, name: 'list', description: 'Open bounties, newest first', options: [{ type: STRING, name: 'crew', description: 'Only this crew’s bounties', required: false, autocomplete: true, max_length: 80 }] },
    { type: SUB_COMMAND, name: 'claim', description: 'Claim an open bounty', options: [{ type: INTEGER, name: 'bounty', description: 'Which bounty (pick one or type its id number)', required: true, autocomplete: true, min_value: 1 }] },
    { type: SUB_COMMAND, name: 'mine', description: 'Bounties you have claimed' },
    { type: SUB_COMMAND, name: 'giveup', description: 'Give up a bounty you claimed', options: [{ type: INTEGER, name: 'bounty', description: 'Which bounty', required: true, autocomplete: true, min_value: 1 }] },
  ],
  dm_permission: false,
} as const

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
