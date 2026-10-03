# Replace UnbelievaBoat with the $PEP economy

**Status:** proposal, plus tooling in this PR (dry-run by default; nothing is live until the owner runs it)
**Guild:** PizzaDAO, `812097286003359764`
**Branch:** `unbelievaboat-migration`

## 1. Goals

1. $PEP in pizzadao-org (`Economy.wallet` and the `Transaction` ledger) becomes the **only** PizzaDAO economy. UnbelievaBoat (UB) is removed from the server.
2. **No member loses a balance.** Every UB balance (cash + bank) is carried into $PEP once, auditable per user, with a signed snapshot kept for audit.
3. **Nobody is paid twice.** The import is idempotent: one unique migration key per Discord ID. UB balances are zeroed at cutover.
4. People who haven't onboarded keep their balance. It is held under their Discord ID and credited on their first login.
5. The Discord habits people actually use keep working: `/work` and `/collect-income` (role income) become **our** slash commands, `/balance`, `/pay` and `/leaderboard` come along, and crime moves to the web app.
6. Every payout, migrated or new, is a ledger row.

Out of scope: **bounties.** UB has no bounty feature, and PizzaDAO's bounties already live in the Google Sheet behind the app.pizzadao.org task list, so there is nothing to migrate. Historical manual payouts (`/add-money` by staff) exist only in UB's **money audit log channel**. Export or keep that channel as the historical record (see §4, step 8).

## 2. What UnbelievaBoat is (research)

### 2.1 Public API (official docs: <https://api-docs.unbelievaboat.com/reference/reference>; `unbelievaboat.com/api/docs` redirects there)

| Topic | Facts |
|---|---|
| Base URL | `https://unbelievaboat.com/api/v1` |
| Auth | `Authorization: <token>`, the bare token with no `Bearer`/`Bot` scheme |
| Token | Created per **Discord application** at <https://unbelievaboat.com/applications>, then authorized for a guild. Only works in guilds where it's authorized. Permission bitfield: `1 = ECONOMY`, `2 = ITEMS` (`GET /applications/@me/guilds/{guild_id}`) |
| Leaderboard | `GET /guilds/{guild_id}/users?sort=total\|cash\|bank&limit=&page=&offset=`. With `page` it returns `{ users: [{rank, user_id, cash, bank, total}], total_pages }`. `limit` defaults to 1000 |
| One user | `GET /guilds/{g}/users/{u}`. `PATCH` adds deltas `{cash, bank, reason}`. `PUT` sets absolute values `{cash, bank, reason}`; the `reason` goes to UB's audit log |
| Items | `GET /guilds/{g}/items` (store: `id, name, price, stock_remaining, unlimited_stock, requirements, actions, ...`). `GET /guilds/{g}/users/{u}/inventory` gives `{ page, total_pages, items: [{item_id, name, quantity, ...}] }`. Create/edit/delete items, add/remove inventory items, and item categories (added June 2026) also exist |
| Rate limits | `X-RateLimit-Limit/-Remaining/-Reset` (reset is **unix ms**). A route-limited 429 returns `{ message, retry_after }` (**ms**). A global 429 returns `{ message, global: true }`. The global cap is **20 req/s per token** |
| Odd values | Unlimited balances have historically come back as the string `"Infinity"`. The tooling flags these as `invalid` instead of guessing |

**Inventories can be exported, but only with a token.** It takes one call per user, which `export.mjs --inventory` makes. There's no bulk inventory endpoint.

### 2.2 Token-less fallback

The public web leaderboard (`https://unbelievaboat.com/leaderboard/812097286003359764`) reads
`GET https://unbelievaboat.com/api/guilds/{guild_id}/leaderboard?limit=25&page=N`. That returns
`{ balances: [{rank,user_id,cash,bank,total}], users: [{id, username, bot, ...}], page, total_pages }` with no auth.
It works today (25 per page; about 11 pages for PizzaDAO), but:

| | Token API (primary) | Public leaderboard (fallback) |
|---|---|---|
| Official / stable | Yes, documented and versioned | No, undocumented and could change any day |
| Needs | Owner creates a token (§9) | Leaderboard must be set to public |
| Balances (cash/bank/total) | Yes | Yes |
| Bot flag / username | Via `--resolve-discord` (DISCORD_BOT_TOKEN) | Included |
| Store items, inventories | Yes (`--store`, `--inventory`) | **No.** Holdings can't be exported |
| Zero UB balances at cutover | Yes (`zero-balances.mjs`) | **No.** Someone has to reset UB by hand (`/reset-economy`) |
| Rate limits | Documented headers | Unknown, so the tool paces itself at 4 req/s |

**Recommendation:** use the token. Fall back to `--public` (or a dashboard CSV via `--from-csv`) only if a token can't be created.

### 2.3 Features, and how PizzaDAO configures them

Live configuration, read from the UB dashboard:

- Currency is `<:pepperoni:973304305979367444>`. Starting balance is 0, there's no cash or bank cap, and balances are split into **cash + bank**.
- **/work:** 30s cooldown, pays 10–100. Default replies are **off**. Custom replies are PizzaDAO "mission prompts" (e.g. "invite a friend to this week's community call… 314 bonus", "share a gif in #… 69-314 bonus"), and staff pay those bonuses by hand.
- **/crime:** on. 30s cooldown, pays 2–420, 60% chance of a fine, fine is 5–55% (percent type).
- **/slut, /rob and games** (blackjack, roulette, russian-roulette, cock-fight, higher-lower) are in the menu, with settings unconfirmed. Assume they may be on.
- **Chat money:** off (0–0).
- **Role income (`/collect-income`):** 11 roles. Crew Member gets 42 cash/day. The others (amounts **TODO**, export them from UB's `/role-income` list) are Pizzaiolo, Pizza Sticks Holder, Pizza Pop Holder, Pizza Tattoo Club, Box Mafia, Pizza Holder, Pizza Mafia, Pizza Capo, Dread Pizza Roberts and Pockets Checked.
- **Store (4 items):**

  | Item | Price | Note |
  |---|---:|---|
  | Global Pizza Party T-shirt | 20,240 | |
  | Proof of Pizza | 13,370 | |
  | Rare Pizza Box | 42,069 | limited stock, 3 left as of 2025-09 |
  | Pizza Sticks | 1,337 | |

- Other UB economy features: deposit/withdraw, give-money, leaderboard/money, add/remove-money (and per-role), reset-money/reset-economy, money-audit-log, economy-stats, clean-leaderboard, set-currency, maximum-balance and set-start-balance.

## 3. Feature parity

**Where things live:**
- The economy lives in `app/lib/economy.ts` (single `Economy.wallet` Int per Discord ID), with `app/lib/transactions.ts` as the ledger.
- Web UI is at `/pep` (`app/pep/page.tsx`, `app/ui/economy/*`, `app/ui/shop/*`). APIs are under `app/api/economy/*`, `app/api/shop/*`, `app/api/inventory/*` and `app/api/jobs/*`.

**Discord bot:** there wasn't one. No sibling repo under `~/Code/pizzadao/` has bot code either, and nothing in the workspace references UnbelievaBoat (grepped `unbelievaboat`, `UNBELIEVABOAT`, `ub_`). `DISCORD_BOT_TOKEN` is only used for REST calls (role sync, announcements, guild joins). **This PR adds the first command handler:** a Discord **HTTP Interactions** endpoint, `app/api/discord/interactions`. It's serverless, needs no gateway process, and fits Vercel.

| UB feature | PizzaDAO uses it? | In pizzadao-org today | Gap | Plan |
|---|---|---|---|---|
| Cash + bank balances | Yes | One `wallet` per Discord ID | No bank | **Merge: wallet += cash + bank** (recommended, §5). Drop deposit/withdraw |
| `/balance`, `/money` | Yes | Web `/pep` WalletCard, `GET /api/economy/balance` | No Discord command | **Built:** `/balance [member]` (ephemeral, read-only lookup) |
| `/leaderboard` | Yes | Web Leaderboard, `GET /api/economy/leaderboard` | No Discord command | **Spec:** `/leaderboard` (top 10 via `getLeaderboard`, names from the members sheet) |
| `/give-money` | Likely | Web transfer (`SendPepModal`, `POST /api/economy/transfer` → `transfer()`) | No Discord command | **Spec:** `/pay member amount` → `transfer()` (already logs both sides) |
| `/work` (30s, 10–100, custom prompts) | Yes | Daily jobs (`JOB_REWARD`) are a different mechanic | No equivalent | **Built:** `/work`, 30s cooldown, 10–100 PEP, PizzaDAO prompts, `WORK_REWARD` ledger row. Prompts come from `WORK_PROMPTS_JSON` today. **Spec:** move them to a sheet tab or table so staff can edit |
| `/crime` (30s, 2–420, 60% fine 5–55%) | Yes | None | Missing | **Built (off by default):** `POST /api/economy/crime` + `commitCrime()`, ledger `CRIME_REWARD`/`CRIME_FINE`, flag `PEP_CRIME_ENABLED=1`. **Spec:** a "Commit a crime" card on `/pep` showing the result and cooldown |
| `/collect-income` (11 roles, per-role interval) | Yes | None | Missing | **Spec:** see §7.2 |
| Store (4 items) | Yes | `ShopItem`/`Inventory`, `/api/shop`, `/api/shop/buy`, sheet sync `/api/shop/sync` | Items not created yet | Add the 4 items to the shop sheet and sync. Rare Pizza Box with `quantity` = remaining stock |
| Inventories / holdings | Yes (store buyers) | `Inventory` table, `/api/inventory`, `/api/inventory/send` | Not migrated | `export.mjs --inventory` captures holdings in the snapshot. Import them as `Inventory` rows (**spec**: a small `import-inventory` step once the shop item IDs exist). Needs the token path |
| Item use/actions (roles on use, etc.) | Unknown | Shop items have no actions | Possibly | Owner checks whether any item grants a role. If so, handle it manually or add later |
| `/rob`, `/slut`, games | Possibly on | None | Missing | **Recommend dropping.** `/rob` makes no sense with a single bankless wallet, and the games are gambling. Owner decision |
| Chat money | Off | `DiscordActivity` stats exist | n/a | Not needed. Could reward engagement later from `DiscordActivity` |
| `add-money` / `remove-money` (+ per role) | Yes (staff bonuses for /work prompts) | No admin grant tool | Missing | **Spec:** admin-only `POST /api/economy/admin/adjust` (+ `/grant` slash command for mods) writing an `ADMIN_ADJUST` ledger row with a reason |
| Money audit log | Yes | `Transaction` ledger + TransactionHistory UI | None | The ledger replaces it. Archive the UB audit-log channel (§4) |
| Starting balance 0, no max | Yes | Wallet defaults to 0. Int max is 2,147,483,647 | None | The tooling flags any balance above Int max |
| Currency emoji | Yes | `PEP_SYMBOL`/`PEP_NAME` env | None | Bot replies use `PEP_EMOJI` (default `$PEP`). Set it to `<:pepperoni:973304305979367444>` |
| economy-stats, clean-leaderboard | Minor | None | Minor | Later: admin stats card. The leaderboard could hide departed users |
| Bounties | **Not a UB feature** | Sheet-backed bounties + `Bounty` model | n/a | No migration |

## 4. Cutover plan

| # | When | Step | Who / tool |
|---|---|---|---|
| 0 | T-14d | Merge this PR. On a **Neon branch** of prod, run `prisma migrate deploy`, then a full rehearsal (steps 4–6) against that branch. Review the plan CSV and decide the open items (§10) | Owner + dev |
| 1 | T-7d | **Announce** in #announcements: date, "your UB balance (cash + bank) becomes $PEP 1:1", "log in at app.pizzadao.org to claim if you aren't a member yet", what commands change | Owner |
| 2 | T-7d | Create the UB **API token** (§9). Optional dry export: `export.mjs` → `import.mjs` dry run, to share totals in the announcement | Owner |
| 3 | T-0, start | **Freeze UB.** In UB's dashboard, disable the economy commands (work, crime, slut, rob, games, give-money, deposit/withdraw, collect-income, buy-item) or restrict them to staff. Turn off role income and chat money. Post "economy frozen" | Owner (UB dashboard) |
| 4 | T-0 | **Final export:** `UB_SNAPSHOT_SIGNING_KEY=... node scripts/unbelievaboat/export.mjs --store --inventory --resolve-discord`. Re-run it a minute later and compare sha256s; a mismatch means the freeze is leaking | Owner/dev |
| 5 | T-0 | **Dry run:** `import.mjs --snapshot … --members crew.csv` (Crew sheet downloaded as CSV) with DATABASE_URL set (read-only). Check: no `invalid`, bots excluded, negatives as expected, totals match the export | Dev, owner signs off |
| 6 | T-0 | **Apply:** `npx prisma migrate deploy` (prod, if not already), then `import.mjs … --apply --confirm-total <N>`. Exit code 0 = zero mismatches. Keep the `diff-*.csv` and `result-*.json` | Dev |
| 7 | T-0 | **Verify** (§6). Then set `PEP_MIGRATION_CLAIMS=1` in Vercel so pending claims pay out on login | Dev |
| 8 | T-0 | **Zero UB:** `zero-balances.mjs --snapshot … --apply --confirm-count <N>`. It skips anyone whose live UB balance moved after the export. Export UB's money-audit-log channel (DiscordChatExporter or a channel archive) | Dev / owner |
| 9 | T-0 | **Switch on the new commands:** set the Interactions Endpoint URL + `DISCORD_PUBLIC_KEY`, `PEP_EMOJI`, then `node scripts/discord/register-commands.mjs --apply`. Optionally `PEP_CRIME_ENABLED=1` once the crime UI ships | Owner (Discord dev portal), dev |
| 10 | T+1d…T+14d | Answer questions in a pinned thread. Watch the pending-claim count go down | Owner |
| 11 | T+14d | **Decommission:** remove UnbelievaBoat from the server, revoke the UB token, archive the snapshot (§6.3) | Owner |

## 5. Balance mapping

- **Formula (recommended default):** `PEP = floor((cash + bank) × rate)`, with **rate = 1**. One wallet; the bank/cash split goes away. `--basis cash|bank` exists only for an owner who wants something different.
- **Conversion rate:** 1:1 by default. Any decimal works (`--rate 0.1`) with exact integer math and per-user floor rounding. The report shows the aggregate rounding loss. A rate ≠ 1 needs its own announcement.
- **Negative balances** (crime fines can push cash below 0): the net `cash + bank` is used, so a negative cash balance is netted against bank. If the net total is still below 0, the user gets nothing and the **debt is forgiven** (status `negative`, listed in the report). PEP wallets never go negative.
- **Not onboarded yet:** the user gets a `PendingPepClaim` row keyed by Discord ID, status `PENDING`. On their first Discord login to app.pizzadao.org the claim is credited (`claimPendingPepOnLogin`, wired into `app/api/discord/callback`, only when `PEP_MIGRATION_CLAIMS=1`). "Matched" means the user is in the members (Crew) sheet with a Discord ID, or already has an app `User` row. Users who have **left the server** (`--resolve-discord`) are also held, never dropped.
- **Bots:** excluded. Use `--resolve-discord` (token path) or the public path's `bot` flag, plus `--exclude ids.txt` for anything else (test accounts, a treasury account).
- **Infinity, or above Int max:** status `invalid`. `--apply` refuses to run until they're excluded or the rate changes.
- **Zero or dust:** skipped (`--min`, default 1 PEP).
- **Store items:** not converted to PEP. Holdings are carried as items (§3).

**Idempotency:** `migrationKey = "unbelievaboat:<guildId>:<discordId>"` is unique. A claim moves `PENDING → CREDITED` through a conditional update in the **same DB transaction** that increments the wallet and writes the `MIGRATION_CREDIT` ledger row (reason "UnbelievaBoat migration", metadata: snapshot sha256, raw cash/bank). That means:
- re-running `--apply`, or a login racing the import, can't double-credit;
- a crash leaves each user either fully credited or untouched;
- a second, different snapshot can't overwrite an existing claim. The difference is reported as a conflict.

## 6. Reconciliation and verification

### 6.1 Before
- The export prints totals (users, Σcash, Σbank, Σtotal). The manifest stores the sha256 of the JSON and CSV, plus an HMAC-SHA256 when `UB_SNAPSHOT_SIGNING_KEY` is set.
- `validateSnapshot` recomputes totals from the rows, so a hand-edited snapshot is rejected. `--apply` refuses when the manifest doesn't verify.

### 6.2 During and after
- The dry-run report breaks totals down by status, and the per-user `plan-*.csv` records each user's decision and reason.
- `--apply --confirm-total N` must equal the reviewed plan's "PEP total to mint".
- After apply, `diff-*.csv` lists every user with wallet before, wallet after, the expected delta and the actual delta, and an `ok` column. The summary checks:
  - Σ expected = Σ actual, with 0 mismatches (the script exits 2 otherwise);
  - `credited + pending = credit + pending users` from the plan;
  - `pepCredited + pepPending = pepTotal`.
- SQL spot checks:
  ```sql
  SELECT status, count(*), sum(amount) FROM "PendingPepClaim" GROUP BY status;
  SELECT count(*), sum(amount) FROM "Transaction" WHERE type = 'MIGRATION_CREDIT';
  ```
- The ledger sum must equal the CREDITED claim sum.

### 6.3 Audit archive
Archive these privately: the snapshot `.json`, `.csv` and `.manifest.json`; the plan, diff and result files; the zero-balances log; and the UB audit-log channel export. Put them in an access-restricted Drive folder, **not the public repo**, since they contain every member's Discord ID and balance. `scripts/unbelievaboat/.gitignore` ignores `snapshots/`. Post only the manifest's sha256 and totals publicly, e.g. in the announcement, so anyone can verify the archive later.

## 7. Discord commands afterwards

### 7.1 Built in this PR
- **`/balance [member]`** is ephemeral and read-only: looking someone up doesn't create rows for them.
- **`/work`** has a 30s cooldown, pays 10–100 PEP, replies with a PizzaDAO prompt and `{amount}` filled in, and writes a `WORK_REWARD` row. When the user is on cooldown it replies ephemerally with "again <t:…:R>".
- Both commands only work in the PizzaDAO guild, never ping anyone (`allowed_mentions: []`), and are verified with Ed25519 (`DISCORD_PUBLIC_KEY`).
- Cooldowns live in `EconomyCooldown (discordId, action)`. The claim is a conditional update or an insert-on-conflict-do-nothing inside the payout transaction, so simultaneous `/work`s pay out once.

### 7.2 Specced, not built
- **`/collect-income`**
  - Config: a `RoleIncome` table, or a sheet tab synced like the shop: `roleId, roleName, amount, intervalHours` (Crew Member = 42 / 24h; the other 10 roles are TODO from UB's `/role-income`).
  - Handler: read `member.roles` from the interaction payload, so no extra Discord call. For each configured role the user holds, call `claimCooldown(tx, id, "income:<roleId>", interval)`, credit the sum, and write a `ROLE_INCOME` row (new enum value) with per-role metadata.
  - UB semantics are "collect what accrued, one payout per interval, no stacking". Match that.
- **`/pay member amount`** → `transfer()`, with the same validation as `POST /api/economy/transfer`.
- **`/leaderboard`** → `getLeaderboard(10)`, mapping Discord IDs to names via the members sheet (falling back to `<@id>` with no pings).
- **`/grant member amount reason`** (mods only, `default_member_permissions`) → an admin ledger adjustment (`ADMIN_ADJUST`). This replaces UB `/add-money` for the /work bonus payouts.
- **Crime UI:** a card on `/pep` that calls `POST /api/economy/crime` and shows the outcome and cooldown. Flip `PEP_CRIME_ENABLED=1` when it ships.

### 7.3 Dropped (pending owner OK)
`/rob`, `/slut`, `/deposit`, `/withdraw` and the casino games.

## 8. Rollback

- **Before step 8** (UB not zeroed yet): `import.mjs --snapshot … --rollback --confirm-rollback`.
  - Every CREDITED claim is reversed (`MIGRATION_REVERSAL` ledger row; the wallet is debited by the credited amount, but never below 0).
  - Every PENDING claim becomes VOID, so it won't pay on login.
  - The report lists any **shortfall** (PEP already spent). Then unset `PEP_MIGRATION_CLAIMS`, re-enable UB's commands, and announce.
- **After step 8:** restore UB from the snapshot with the token: `PUT /guilds/{g}/users/{u} {cash, bank}` per user, using the zero-balances log. This is **spec only**: a `restore-ub.mjs` mirror of `zero-balances.mjs`. Then roll back PEP as above.
- **Schema:** the migration is additive (two new tables, one new enum, five new enum values), so leaving it in place is harmless. Postgres can't drop enum values easily, so don't try.
- **Commands:** `register-commands.mjs` with an empty list (or deleting them in the dev portal) removes `/balance` and `/work`. Clearing the Interactions Endpoint URL disables the route.

## 9. What the owner must provide

1. **UB API token.**
   - Log into <https://unbelievaboat.com/applications> with an account that manages the PizzaDAO server.
   - Create an application (it can be tied to the existing PizzaDAO Discord application ID) and generate a token.
   - Authorize it for guild `812097286003359764` with **Economy** (and **Items**, to export store and inventories).
   - Hand it over as `UNBELIEVABOAT_API_TOKEN` in a local shell only, not in Vercel. The app never needs it.
   - Revoke it after decommissioning.
2. **Freeze date and time**, plus the announcement copy (§4).
3. **Conversion rate.** 1:1 on cash + bank is recommended.
4. **Policy calls:**
   - negative balances (forgive, which is recommended);
   - bots or other accounts to exclude;
   - whether pending claims expire (recommended: never; at most, revisit in 6 months).
5. **Role income table:** the amount and interval for all 11 roles, from UB's `/role-income` list.
6. **Store and holdings:** confirm the 4 items, whether any item grants a role on use, and that the Rare Pizza Box stock is 3.
7. **Discord application settings** for the slash commands:
   - Interactions Endpoint URL = `https://app.pizzadao.org/api/discord/interactions`;
   - Vercel env vars `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` and `PEP_EMOJI`.
   - If the PizzaDAO application already serves interactions some other way, use a new application.
8. **Run the DB migration** `20261003000000_pep_migration_and_earning` (`npx prisma migrate deploy`). Vercel's build only runs `prisma generate`, not migrations. Rehearse on a Neon branch first.
9. A private archive location for the snapshot and audit files, and optionally a `UB_SNAPSHOT_SIGNING_KEY` kept offline.

## 10. Open decisions

| Decision | Recommendation |
|---|---|
| Rate | 1 UB (cash + bank) = 1 PEP |
| Negative balances | Forgive (net cash + bank; below 0 → nothing) |
| Pending-claim expiry | None |
| Users who left the server | Hold like any non-member |
| `/rob`, `/slut`, games | Drop |
| Crime | Web only (decided). Launch with the UI |
| /work prompts source | Sheet tab, editable by staff (today: `WORK_PROMPTS_JSON`) |
| Bonus payouts for /work missions | `/grant` mod command (spec) |
| Export path | Token API (decided primary). Public leaderboard is the fallback |
| Inventory migration | Yes, if the token path is used. Recreate the 4 items first |
| Chat money | Stay off |

## 11. Running the migration (cheat sheet)

```bash
# 0. once: migration (Neon branch first, then prod)
npx prisma migrate deploy

# 1. export (token path) – writes scripts/unbelievaboat/snapshots/ub-<guild>-<ts>.{json,csv,manifest.json}
UNBELIEVABOAT_API_TOKEN=... DISCORD_GUILD_ID=812097286003359764 DISCORD_BOT_TOKEN=... \
UB_SNAPSHOT_SIGNING_KEY=... node scripts/unbelievaboat/export.mjs --store --inventory --resolve-discord
#    no token: node scripts/unbelievaboat/export.mjs --public

# 2. dry run (Crew sheet → File › Download › CSV)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --members crew.csv [--exclude bots.txt]

# 3. apply (N = "PEP total to mint" from the dry run)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --members crew.csv --apply --confirm-total N

# 4. enable login claims: set PEP_MIGRATION_CLAIMS=1 in Vercel

# 5. zero UB (token path only)
UNBELIEVABOAT_API_TOKEN=... DISCORD_GUILD_ID=812097286003359764 \
node scripts/unbelievaboat/zero-balances.mjs --snapshot <snap>.json --apply --confirm-count M

# 6. slash commands
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=812097286003359764 \
node scripts/discord/register-commands.mjs --apply

# rollback (before step 5)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --rollback --confirm-rollback
```

The scripts need Node ≥ 22.18. They re-exec themselves with `--experimental-transform-types` and a small resolve hook (`scripts/unbelievaboat/run-ts.mjs`), so they run the app's own TypeScript (`app/lib/economy.ts`, `app/lib/transactions.ts`, `app/lib/db.ts`). The migration therefore credits through exactly the code paths the app uses.

## 12. Files

| Path | What |
|---|---|
| `app/lib/unbelievaboat/ub-api.ts` | UB client: token API and public fallback, pagination, 429/global/5xx handling, `setBalance` |
| `app/lib/unbelievaboat/snapshot.ts` | Snapshot build, CSV, sha256 + HMAC manifest, validation |
| `app/lib/unbelievaboat/plan.ts` | Mapping and categorization, rate math, report, plan CSV |
| `app/lib/unbelievaboat/members-source.ts` | Crew sheet CSV → discordId → memberId (same aliases as `member-repository.ts`) |
| `app/lib/unbelievaboat/claims.ts` | Stage, credit, login claim and reverse, all via `getOrCreateEconomy` + `logTransaction` |
| `app/lib/unbelievaboat/reconcile.ts` | Before/after per-user diff |
| `app/lib/unbelievaboat/discord-lookup.ts` | Bot / left-server / username annotation |
| `scripts/unbelievaboat/{export,import,zero-balances}.mjs` | CLIs (dry-run by default) |
| `app/lib/pep-earn/{cooldown,work,crime}.ts` | Race-safe cooldowns, `/work`, crime |
| `app/lib/discord-interactions/{verify,commands,handle}.ts` | Ed25519 verification, command definitions, dispatch |
| `app/api/discord/interactions/route.ts` | Interactions endpoint |
| `app/api/economy/crime/route.ts` | Web crime (behind `PEP_CRIME_ENABLED`) |
| `scripts/discord/register-commands.mjs` | Guild command registration (dry-run by default) |
| `prisma/migrations/20261003000000_pep_migration_and_earning` | `PendingPepClaim`, `EconomyCooldown`, `PepClaimStatus`, `TransactionType` += `MIGRATION_CREDIT`, `MIGRATION_REVERSAL`, `WORK_REWARD`, `CRIME_REWARD`, `CRIME_FINE` |
| `app/api/discord/callback/route.ts` | +1 fire-and-forget call: `claimPendingPepOnLogin(me.id)` |

## Appendix: current UnbelievaBoat role income (read from the UB dashboard, 2026-10-03)

All are *collectable* (via `/collect-income`), paid in **cash**, once per **1 day**:

| Role | PEP / day |
|---|---|
| Dread Pizza Roberts | 420 |
| Pizzaiolo | 690 |
| Pizza Holder | 69 |
| Pizza Mafia | 69 |
| Pizza Capo | 69 |
| Crew Member | 42 |
| Box Mafia | 42 |
| Pizza Sticks Holder | 8 |
| Pizza Pop Holder | 8 |
| Pizza Tattoo Club | 8 |
| Pockets Checked | 1 |

Members with several roles collect each role's income (UB behaviour). Port these values as-is unless the owner says otherwise.
