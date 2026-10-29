# Proposals and voting

How proposals are voted on in the app, what you must configure, and what the secrecy does and does not cover. The design and decisions are in `plans/proposals-voting.md`.

## How it works

1. A member who holds the voter role (default: Box Mafia) submits a proposal at `/proposals/new`. The proposal is created as a draft.
2. Right after, the app opens it: it lists every guild member holding the voter role through the Discord API, stores that list (the eligibility snapshot), generates this proposal's own RSA signing key pair, copies the pass rule onto the proposal, and starts the voting window. If the Discord listing fails, the proposal stays a draft and the hourly cron retries.
3. Metalhead posts the proposal in the proposals channel with a link and the voting-key fingerprint. There is no voting in Discord.
4. When an eligible member is on the site, their browser asks for a blind-signed ballot token (once per member per proposal; the server never sees the token). Voting is a separate, unauthenticated request carrying the token and the choice. The same token replaces the earlier choice until the proposal closes.
5. The hourly cron counts proposals past their close time. A proposal passes when (ayes + abstains) reach the threshold and ayes are more than nays. Thresholds come from the payments tier settings (funding) or `proposals.generalAyes`.
6. With `proposals.enabled` on, a payment request above the on-approval cap must link a passed funding proposal of the requester's; reviewers can also link one. Sesh links and typed counts are ignored.

## Configuration

Settings (admin page, group "Proposals" and "Discord channels and roles"):

| Setting | Meaning |
|---|---|
| `proposals.enabled` | The whole feature. Off by default. The `PROPOSALS_ENABLED` environment variable set to off always wins. Unreadable settings mean off. |
| `proposals.voterRoleId` | Role whose holders can vote and propose. Empty uses the Box Mafia role. |
| `proposals.windowDays` | Voting window, 7 to 14 days, can only be lengthened. |
| `proposals.generalAyes` | Threshold for proposals that ask for no money, can only be raised. |
| `discord.proposalsChannelId` | Where proposals and results are posted (falls back to `PROPOSALS_CHANNEL_ID`, then the channel named "proposals"). |
| `discord.proposalsPingRoleId` | Optional role pinged on a new proposal. |

Environment variables:

| Variable | Required | Meaning |
|---|---|---|
| `PROPOSAL_KEY_WRAP_SECRET` | yes | At least 32 random characters. Encrypts each proposal's private signing key at rest. Losing it makes open proposals impossible to vote on or count; rotating it needs a re-wrap. |
| `RATE_LIMIT_IP_SALT` | recommended | Secret salt for the hashed IP used by rate limits, including the vote endpoint. |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | yes | Used to list role holders and post. The bot needs the server members intent. |
| `CRON_SECRET` | yes | For the cron route. |
| `PROPOSALS_ENABLED` | no | Kill switch (set to `off`) or legacy default. |
| `PROPOSALS_CHANNEL_ID` | no | Channel fallback. |

`RSA_PRIVATE_KEY_PEM` and `RSA_PUBLIC_KEY_PEM` (the old poll key pair) are not used by proposals. The old poll signer now answers 410.

Voting only works on the production deployment (`VERCEL_ENV=production`): previews share the production database and must not open, issue or count.

## What the secrecy covers

- A ballot row holds only a hash of the token and the choice: no member id, no IP, no timestamp. Tokens and choices are never logged by the app.
- The server records that a token was issued to a member (day precision) and never re-issues it.
- The vote request carries no cookies and no referrer; a vote made soon after the token was fetched is held back (30 minutes plus a random delay) so the two requests are far apart.

What it does not cover: hosting-provider request logs (IP and time) and database point-in-time history are outside the app. The time gap makes matching a vote to a token request harder, not impossible. People with database or hosting access are trusted not to combine those sources.

## Recovering a ballot

The ballot lives in the member's browser. Two ways back: the vote code (always offered with a Save code button), and an optional wallet-backed backup (ciphertext only; the key comes from a wallet signature that never leaves the browser). Wallets whose signatures are not repeatable (some smart-contract wallets) cannot restore a backup; the app detects that and says so. A member who has neither can still not vote again, because the token is issued once; their existing vote stays counted.

## Rollout notes

- The migration `20261103000000_proposals` is additive. Apply it before enabling.
- Set `PROPOSAL_KEY_WRAP_SECRET` before turning the feature on.
- Payments: with the feature on, requests created through the form need a proposal above the cap; requests that came in through the public form can be linked by a reviewer.
