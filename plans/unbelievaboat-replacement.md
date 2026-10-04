# Replace UnbelievaBoat with the $PEP economy

**Status:** owner decisions made (2026-10-03, see §0). Part 1 (#134, merged): balance import tooling, `/balance`, `/work`, web crime API. Part 2 (branch `ub-replacement-2`): `/collect-income`, `/pay`, `/leaderboard`, blackjack/roulette/slots, `/shop` + `/buy`, store seed + item-grant scripts, crime and games cards on `/pep`. Everything that changes live behaviour is behind a flag or needs an owner step; nothing is live until the owner runs §4. **2026-10-03 (owner decision): `/rob` and `/peace` were removed entirely** (§7.4), and replies no longer label anything as cash or bank: there is one wallet, shown as $PEP.
**Guild:** PizzaDAO, `812097286003359764`

## 0. Owner decisions (2026-10-03)

| Topic | Decision |
|---|---|
| UB API token | **None.** Export balances only from the public leaderboard (`export.mjs --public`). Item holdings are entered by hand (§7.6). UB balances are reset by hand in UB at cutover |
| Balances | **Merge cash + bank 1:1** into the single wallet. **Forgive negative** net balances |
| `/rob` | **Removed** (owner decision, 2026-10-03; was first kept, see §7.4) |
| `/slut` | **Drop** |
| Games | **Add** blackjack, roulette and slots (§7.5). Russian roulette, cock-fight and higher-lower are dropped |
| Store | **Move** UB's 4 items to the $PEP shop (§7.6) |
| Everything else | Moves to app.pizzadao.org and our bot. UnbelievaBoat is removed after cutover |

## 1. Goals

1. $PEP in pizzadao-org (`Economy.wallet` and the `Transaction` ledger) becomes the **only** PizzaDAO economy. UnbelievaBoat (UB) is removed from the server.
2. **No member loses a balance.** Every UB balance (cash + bank) is carried into $PEP once, auditable per user, with a signed snapshot kept for audit.
3. **Nobody is paid twice.** The import is idempotent: one unique migration key per Discord ID. UB balances are zeroed at cutover.
4. People who haven't onboarded keep their balance. It is held under their Discord ID and credited on their first login.
5. The Discord habits people actually use keep working: `/work`, `/collect-income`, `/balance`, `/pay`, `/leaderboard`, the games and the store become **our** slash commands, and crime moves to the web app.
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

**Decided (owner, 2026-10-03): no token; use `--public`.** Consequences: no inventory export (holdings are entered by hand, §7.6) and UB can't be zeroed by script (reset it by hand, §4 step 8). A dashboard CSV via `--from-csv` remains a fallback if the leaderboard endpoint changes.

### 2.3 Features, and how PizzaDAO configures them

Live configuration, read from the UB dashboard:

- Currency is `<:pepperoni:973304305979367444>`. Starting balance is 0, there's no cash or bank cap, and balances are split into **cash + bank**.
- **/work:** 30s cooldown, pays 10–100. Default replies are **off**. Custom replies are PizzaDAO "mission prompts" (e.g. "invite a friend to this week's community call… 314 bonus", "share a gif in #… 69-314 bonus"), and staff pay those bonuses by hand.
- **/crime:** on. 30s cooldown, pays 2–420, 60% chance of a fine, fine is 5–55% (percent type).
- **/slut, /rob and games** (blackjack, roulette, slots, russian-roulette, cock-fight, higher-lower) are in the menu, with settings unconfirmed. Owner decision: drop /rob (removed 2026-10-03, §7.4) and /slut, port blackjack/roulette/slots (§7.5).
- **Chat money:** off (0–0).
- **Role income (`/collect-income`):** 11 roles, all daily; amounts in the appendix (ported as-is, §7.2).
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
- The economy lives in `app/lib/economy.ts` (single `Economy.wallet` Int per Discord ID), with `app/lib/transactions.ts` as the ledger. Every PEP movement goes through `creditInTx`/`debitInTx` (conditional debit, ledger row in the same DB transaction, never below 0).
- Web UI is at `/pep` (`app/pep/page.tsx`, `app/ui/economy/*`, `app/ui/shop/*`). APIs are under `app/api/economy/*`, `app/api/shop/*`, `app/api/inventory/*` and `app/api/jobs/*`.
- Discord: a serverless **HTTP Interactions** endpoint, `app/api/discord/interactions` (no gateway process). PizzaDAO had no bot code before #134.

| UB feature | Status | Notes |
|---|---|---|
| Cash + bank balances | **Decided: merge 1:1** | `wallet += cash + bank`; negatives forgiven (§5). No deposit/withdraw |
| `/balance`, `/money` | **Built (#134)** | `/balance [member]`, ephemeral, read-only |
| `/work` | **Built (#134)** | 30s, 10-100, PizzaDAO prompts, `WORK_REWARD` |
| `/crime` | **Built, web only, off** | `POST /api/economy/crime` (#134) + **crime card on `/pep`** (this PR). Flag `PEP_CRIME_ENABLED=1` |
| `/collect-income` | **Built** | §7.2. 11 roles, daily, `ROLE_INCOME` |
| `/give-money` | **Built** as `/pay member amount` | Hardened `transfer()` (now deadlock-free, §7.1) |
| `/leaderboard` | **Built** | Top 10 by wallet, names from the members sheet |
| `/rob` | **Removed** (owner, 2026-10-03) | §7.4. `/peace` removed with it |
| `/slut` | **Dropped** (owner) | |
| Games | **Built, off** | Blackjack, roulette, slots on Discord **and** `/pep`. Flag `PEP_GAMES_ENABLED=1`. §7.5 |
| Store (4 items) | **Built** | Seed script + Shop-tab rows (§7.6); `/shop`, `/buy item [quantity]` on Discord |
| Inventories / holdings | **Built (manual)** | No token, so holdings can't be exported: staff list them in a CSV and run `grant-items.mjs` (§7.6) |
| Item use/actions (roles on use) | Open | Owner checks whether any UB item grants a role. If so, grant it by hand |
| Chat money | Off in UB | Not needed |
| `add-money` / `remove-money` | **Built** | The `/grant` spec, built as `/add-money` and `/remove-money` (admins + Pepperoni Mafia, `ADMIN_GRANT` / `ADMIN_REMOVE` ledger rows, §7.7) |
| Money audit log | Replaced | The `Transaction` ledger. Archive UB's audit-log channel (§4) |
| Currency emoji | Built | `PEP_EMOJI` (set to `<:pepperoni:973304305979367444>`) |
| Bounties | Not a UB feature | No migration |

## 4. Cutover plan (token-less)

| # | When | Step | Who / tool |
|---|---|---|---|
| 0 | T-14d | Merge the PRs. On a **Neon branch** of prod: `npx prisma migrate deploy` (applies `20261003000000_pep_migration_and_earning` and `20261004000000_pep_discord_economy`), then rehearse steps 4-6 against that branch | Owner + dev |
| 1 | T-14d | **Store:** add UB's 4 items to the **Shop** tab of the jobs/shop sheet (rows printed by `node scripts/unbelievaboat/seed-store.mjs --rare-box-stock N`). Confirm Rare Pizza Box stock. Collect **item holdings** by hand into a private CSV `discordId,item,qty` | Owner / staff |
| 2 | T-7d | **Announce** in #announcements: date, "your UB balance becomes $PEP 1:1, debts are forgiven", "log in at app.pizzadao.org to claim if you aren't a member yet", the new commands. Optional: run `export.mjs --public` → `import.mjs` dry run to quote totals | Owner |
| 3 | T-0, start | **Freeze UB.** In UB's dashboard disable the economy commands (work, crime, slut, rob, games, give-money, deposit/withdraw, collect-income, buy-item) or restrict them to staff. Turn off role income. Make sure the **leaderboard is public** (the export needs it). Post "economy frozen" | Owner (UB dashboard) |
| 4 | T-0 | **Final export:** `UB_SNAPSHOT_SIGNING_KEY=... node scripts/unbelievaboat/export.mjs --public`. Re-run a minute later and compare sha256s; a mismatch means the freeze is leaking | Owner/dev |
| 5 | T-0 | **Dry run:** `import.mjs --snapshot … --members crew.csv` (Crew sheet as CSV) with DATABASE_URL set. Check: no `invalid` (UB "Infinity" balances), bots excluded (the public leaderboard carries bot flags), negatives forgiven, totals match | Dev, owner signs off |
| 6 | T-0 | **Apply:** `import.mjs … --apply --confirm-total <N>`. Then `grant-items.mjs --csv holdings.csv` (dry run) and `--apply`. Keep the `diff-*.csv`, `result-*.json` and grant output | Dev |
| 7 | T-0 | **Verify** (§6). Then set `PEP_MIGRATION_CLAIMS=1` in Vercel so pending claims pay out on login | Dev |
| 8 | T-0 | **Reset UB by hand:** without a token `zero-balances.mjs` can't run, so use UB's `/reset-economy` (or remove UB right away, step 11). Export UB's money-audit-log channel (DiscordChatExporter or a channel archive) first | Owner |
| 9 | T-0 | **Switch on the new commands:** Interactions Endpoint URL + `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` (already set), `PEP_EMOJI`; `node scripts/discord/register-commands.mjs --apply`. Then flip, when wanted: `PEP_CRIME_ENABLED=1`, `PEP_GAMES_ENABLED=1` | Owner (Discord dev portal + Vercel), dev |
| 10 | T+1d…T+14d | Answer questions in a pinned thread. Watch the pending-claim count go down. Run `scripts/pep-reconcile.sql` (read-only) weekly | Owner / dev |
| 11 | T+14d | **Decommission:** remove UnbelievaBoat from the server; archive the snapshot (§6.3) | Owner |

**Do not register the new commands while UB still answers the same names** (`/work`, `/balance`, `/pay` vs UB's own, `/leaderboard`, `/blackjack`, ...). Discord shows both apps' commands; members would pick the wrong one. Register at step 9, after UB is frozen.

## 5. Balance mapping

- **Formula (recommended default):** `PEP = floor((cash + bank) × rate)`, with **rate = 1**. One wallet; the bank/cash split goes away. `--basis cash|bank` exists only for an owner who wants something different.
- **Conversion rate:** 1:1 by default. Any decimal works (`--rate 0.1`) with exact integer math and per-user floor rounding. The report shows the aggregate rounding loss. A rate ≠ 1 needs its own announcement.
- **Negative balances** (crime fines can push cash below 0): the net `cash + bank` is used, so a negative cash balance is netted against bank. If the net total is still below 0, the user gets nothing and the **debt is forgiven** (status `negative`, listed in the report). PEP wallets never go negative.
- **Not onboarded yet:** the user gets a `PendingPepClaim` row keyed by Discord ID, status `PENDING`. On their first Discord login to app.pizzadao.org the claim is credited (`claimPendingPepOnLogin`, wired into `app/api/discord/callback`, only when `PEP_MIGRATION_CLAIMS=1`). "Matched" means the user is in the members (Crew) sheet with a Discord ID, or already has an app `User` row. Users who have **left the server** (`--resolve-discord`) are also held, never dropped.
- **Bots:** excluded. The public leaderboard's `bot` flag marks them (`--resolve-discord` only runs on the token path), plus `--exclude ids.txt` for anything else (test accounts, a treasury account).
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

## 7. Discord commands and economy features

All commands work only in the PizzaDAO guild and are verified with Ed25519 (`DISCORD_PUBLIC_KEY`). Replies are UnbelievaBoat-style embeds (`app/lib/discord-interactions/embeds.ts`): the invoking member as author (display name + avatar), green for success, red for errors and refusals, amber for cooldowns, a ✅/❌/⏳ headline, and numbered lists (`1 - <@&role> 🍕 420`). Mentions inside embeds never ping; `allowed_mentions` is `{ parse: [] }` everywhere except `/pay`, `/add-money` and `/remove-money`, which ping the one member they name. Validation errors (bad amount, insufficient funds, out of stock) and cooldowns are answered ephemerally. Every PEP movement is a ledger row written in the same DB transaction as the wallet change; cooldowns are claimed in that transaction too (`EconomyCooldown`), so concurrent invocations can't double-pay. Real-Postgres race tests for all of it: `npm run test:pep-concurrency`.

### 7.1 Built
| Command | Behaviour |
|---|---|
| `/balance [member]` | Ephemeral, read-only (#134) |
| `/work` | 30s, 10-100, prompt reply, `WORK_REWARD` (#134) |
| `/collect-income` | §7.2 |
| `/pay member amount` | Positive whole amount, not yourself, not a bot. Uses `transfer()`: conditional debit + credit + `TRANSFER_SENT`/`TRANSFER_RECEIVED` rows. **Fixed in this PR:** two members paying each other at the same moment deadlocked (Postgres aborted one); both wallets are now locked in id order first |
| `/leaderboard` | Top 10 by wallet, numbered `1 - <@user> 🍕 amount` (mentions inside the embed render as names and never ping, so the members-sheet name lookup was dropped) |
| `/blackjack bet`, `/roulette bet space`, `/slots bet` | §7.5, flag `PEP_GAMES_ENABLED` |
| `/shop`, `/buy item [quantity]` | §7.6. `/buy` autocompletes item names and uses the hardened `buyItem()` |
| `/add-money member amount reason`, `/remove-money member amount reason` | §7.7, admins and Pepperoni Mafia |

Web: crime card and games card on `/pep`, shown only when `GET /api/economy/features` reports the flag on.

### 7.2 Role income (`/collect-income`)
- Table in code (`app/lib/pep-earn/income.ts`, `DEFAULT_ROLE_INCOME`) with the UB values from the appendix: every role daily, paid into the one $PEP wallet. Staff can override it without a code change with **`ROLE_INCOME_JSON`** (`[{"name":"Crew Member","amount":42,"intervalHours":24,"roleId":"..."}]`; invalid JSON falls back to the built-in table and logs a warning).
- Role ids: Dread Pizza Roberts (`812131585327235113`) and Pizza Capo (`839206162837798945`) are pinned. The rest are resolved **by name** from `GET /guilds/{id}/roles` with the bot token, cached for an hour, matching names case-, space-, punctuation- and emoji-insensitively. A name that matches no role or several roles is skipped and logged (`[collect-income] unresolved roles`). Pin an id in `ROLE_INCOME_JSON` to fix either case.
- The member's roles come from the interaction payload (`member.roles`), so no extra Discord call per use.
- Per role and member, cooldown `income:<roleId>` (24h). Members collect every role they hold, one `ROLE_INCOME` row per role. Like UB: no stacking; a missed day is not paid later.

### 7.3 Dropped / not built
- Dropped (owner): `/rob` and `/peace` (removed 2026-10-03), `/slut`, `/deposit`, `/withdraw`, russian roulette, cock-fight, higher-lower.
- Built: the `/grant member amount reason` spec is now `/add-money` and `/remove-money` (§7.7).
- Not built yet: moving /work prompts to a sheet tab.

### 7.4 `/rob` (removed)
**Removed per owner decision, 2026-10-03.** `/rob` and its `/peace` opt-out were built behind `PEP_ROB_ENABLED`; the commands, `app/lib/pep-earn/rob.ts`, the `PEP_ROB_ENABLED` / `ROB_*` / `PEACE_*` config and the `rob` entry in `/api/economy/features` are gone. Re-run `node scripts/discord/register-commands.mjs --apply` so Discord drops the registered `/rob` and `/peace` (until then they answer "Unknown command.").

Database: the `ROB_STEAL` / `ROB_LOSS` / `ROB_FINE` enum values and the `EconomyPeaceMode` table stay (dropping Postgres enum values is invasive; no rows should exist). `scripts/pep-reconcile.sql` still checks `ROB_*` signs so any historical rows reconcile. A later cleanup migration can drop `EconomyPeaceMode`.

### 7.5 Games
Off unless **`PEP_GAMES_ENABLED=1`** (Discord and web). `app/lib/pep-games/`.

- **Bets** come from the wallet: whole PEP, **10 to 5,000** (`GAME_MIN_BET`, `GAME_MAX_BET`).
- **Rate limit:** one game start per **3 seconds** per member (`GAME_COOLDOWN_SECONDS`), claimed in the stake's transaction. Blackjack button presses don't count.
- **RNG:** `node:crypto` (`randomInt`), server-side only. Never `Math.random`.
- **Ledger:** `GAME_BET` (-stake) and `GAME_WIN` (+total return, stake included; a push returns the stake as `GAME_WIN`). Stake, outcome and payout commit in one transaction (roulette, slots) or settle exactly once (blackjack).

| Game | Rules | Returns (stake incl.) | House edge |
|---|---|---|---|
| Roulette | Single-zero wheel 0-36. `space` = red, black, even, odd, or a number | Red/black/even/odd **2x** (0 loses); number **36x** | 1/37 = **2.70%** |
| Slots | 3 reels, 32 weighted stops each: 🍕2 🌶️3 🍄5 🧀7 🍅15 | Three 🍕 **100x**, 🌶️ 50x, 🍄 20x, 🧀 8x, 🍅 5x; two 🍕 4x; one 🍕 1x (stake back) | RTP 31109/32768 = 94.94%, edge **5.06%**; 29.4% of spins return something |
| Blackjack | One 52-card deck per hand; dealer stands on all 17s; no double/split/insurance | Blackjack **2.5x** (3:2, rounded down), win 2x, push 1x | About **2%** with basic strategy (a fresh single deck favours the player, but no doubling or splitting costs ~2%) |

**Blackjack state:** `BlackjackGame` rows (deck, hands, version). `/blackjack` posts the hand with **Hit** / **Stand** buttons (message components, `custom_id = bj:<action>:<gameId>`); only the owner can press them. Guarantees:
- one live hand per member (`activeKey` unique = discordId while ACTIVE);
- every move is a conditional update on `(id, status=ACTIVE, version)`: a double-click or a second tab applies once and the other press just re-renders;
- settlement is the conditional `ACTIVE → SETTLED` flip with the `GAME_WIN` credit in the same transaction: a hand pays out at most once (`scripts/pep-reconcile.sql` check `blackjack_payout`);
- **timeout:** a hand idle for **5 minutes** (`BLACKJACK_TIMEOUT_SECONDS`) **auto-stands** on the next button press, the member's next `/blackjack` or web visit, or the opportunistic sweep every blackjack request runs (up to 5 expired hands). There is no cron, so an abandoned hand's stake stays escrowed until one of those happens.

### 7.6 Store and holdings
- **Source of truth (since the shop admin page):** **`/admin/shop`** in the app (shop admins = admin roles + Pepperoni Mafia, the `/add-money` rule). It creates / edits / hides / restocks items, grants and removes items to / from members, and logs every change in `ShopAdminEvent`. Items with any purchase, holding or grant can only be hidden, never deleted.
- **Sheet sync retired:** `POST /api/shop/sync` is now a **no-op unless `SHOP_SHEET_SYNC_ENABLED=1`** (it answers `200 { skipped: true }` after the secret check, writes nothing), so a stray Apps Script push can't overwrite admin edits. Leave the flag unset in Vercel. Before setting it, know that a sync overwrites price / stock / availability from the sheet and **deactivates items missing from the sheet**. Remove the Apps Script trigger and then the endpoint once `/admin/shop` has been in use for a while.
- *(Historical)* the **Shop** tab of the jobs/shop sheet (`scripts/jobs-sync/Code.js` pushed it to `POST /api/shop/sync`) used to be the source of truth.
- `node scripts/unbelievaboat/seed-store.mjs [--rare-box-stock N] [--apply]` prints the 4 rows to paste into the Shop tab (Name, Description, Price, Quantity, Image URL): Global Pizza Party T-shirt 20,240; Proof of Pizza 13,370; Rare Pizza Box 42,069 (limited, stock = N); Pizza Sticks 1,337. With DATABASE_URL and `--apply` it also creates missing items in the DB (existing ones are left alone and differences listed). Rare Pizza Box stock is unknown today (3 in 2025-09): the owner supplies it.
- ⚠️ **Limited stock vs the sheet sync (only if `SHOP_SHEET_SYNC_ENABLED=1`):** every sync sets the DB `quantity` to the sheet's Quantity, undoing sales and `/admin/shop` restocks. With the flag unset (the default) this no longer happens; restock in `/admin/shop`.
- **Holdings:** `node scripts/unbelievaboat/grant-items.mjs --csv holdings.csv [--apply]`, CSV `discordId,item,qty`. Dry run by default. Idempotent: each (member, item) is granted once (`ItemGrant.grantKey`), with the `Inventory` increment in the same transaction; re-runs report `already_granted`, a different qty is a `conflict` (never applied). `--apply` refuses while the CSV has errors, unknown items or duplicates. Grants don't touch stock or wallets. Keep the CSV out of the repo.
- Discord: `/shop` (ephemeral list with stock), `/buy item [quantity]` (autocomplete; `buyItem()`: conditional debit, conditional stock decrement, inventory upsert, one transaction).

### 7.7 Admin money (`/add-money`, `/remove-money`)
Replaces UB's `add-money` / `remove-money` (e.g. /work mission bonuses, fixing mistakes).
- **Who:** members holding a role in `ADMIN_ROLE_IDS` (`app/ui/constants.ts`) or **Pepperoni Mafia**, checked against `member.roles` in the interaction payload. Extra roles are configurable: **`PEP_ADMIN_ROLE_IDS`** (comma-separated ids) and **`PEP_ADMIN_ROLE_NAMES`** (comma-separated names, default `Pepperoni Mafia`; `-` for none). Names resolve through the cached guild role list (`guild-roles.ts`, same as role income), falling back to the pinned Pepperoni Mafia id (`823266914834841610`) if the list is unavailable. A fixed-id match needs no lookup at all. The commands are registered without `default_member_permissions`, so everyone sees them and non-holders get an ephemeral ❌. To hide them from others, set per-command role permissions in Server Settings > Integrations > Pepperoni Bot.
- **Input:** `amount` is a positive whole number up to **`ADMIN_GRANT_MAX`** (default 10000); `reason` is required, 3-200 characters (whitespace collapsed). The target can't be a bot; `/add-money` needs them in the server, `/remove-money` works on members who left.
- **Money:** `/add-money` creates the member's User/Economy rows if needed (like `/pay` recipients) and credits with an `ADMIN_GRANT` row. `/remove-money` is a conditional decrement (`wallet >= amount`) with an `ADMIN_REMOVE` row: it never takes a wallet below 0, and when the wallet is short it removes nothing and replies with the current balance. Ledger metadata: `{ adminId, reason, source: "discord" }`.
- **Reply:** public embed, e.g. "🍕 @admin gave @member 🍕 314: reason", pinging only the member. If **`PEP_ADMIN_LOG_CHANNEL_ID`** is set (and `DISCORD_BOT_TOKEN`), the same line is posted there after the reply (`next/server` `after()`).
- **Migration:** `20261005000000_admin_grant_types` adds the two enum values. Apply it before deploying the code.
- **Reconcile:** `scripts/pep-reconcile.sql` checks their signs and reports `minted_admin` / `burned_admin` in the summary.

## 8. Rollback

- **Before step 8** (UB not zeroed yet): `import.mjs --snapshot … --rollback --confirm-rollback`.
  - Every CREDITED claim is reversed (`MIGRATION_REVERSAL` ledger row; the wallet is debited by the credited amount, but never below 0).
  - Every PENDING claim becomes VOID, so it won't pay on login.
  - The report lists any **shortfall** (PEP already spent). Then unset `PEP_MIGRATION_CLAIMS`, re-enable UB's commands, and announce.
- **After step 8:** without a token UB can't be restored by script; balances would have to be re-entered in UB by hand (`/add-money`) from the snapshot. Avoid: only reset UB once the import has been verified.
- **Schema:** the migrations are additive (new tables, enums and enum values), so leaving them in place is harmless. Postgres can't drop enum values easily, so don't try.
- **Features:** unset `PEP_GAMES_ENABLED` / `PEP_CRIME_ENABLED` to switch them off instantly (Discord replies "not enabled", web APIs 404, `/pep` hides the cards). Live blackjack hands still settle on the next press or sweep once games are back on; to refund them sooner, flip the flag back on briefly or settle them by hand.
- **Item grants:** reverse by hand (decrement `Inventory`, delete the `ItemGrant` row) if a CSV line was wrong.
- **Commands:** deleting them in the dev portal (or registering an empty list) removes them. Clearing the Interactions Endpoint URL disables the route.

## 9. What the owner must do

1. **Migrations** (Vercel builds don't run them): on a Neon branch first, then prod, `npx prisma migrate deploy`. Pending: `20261003000000_pep_migration_and_earning` (if not yet applied) and **`20261004000000_pep_discord_economy`**. Apply before deploying code that uses them.
2. **Freeze date and time**, plus the announcement copy (§4).
3. **Policy calls still open:** bots or other accounts to exclude from the import; pending-claim expiry (recommended: never).
4. **Store:** add the 4 rows to the Shop tab (§7.6); give the **Rare Pizza Box remaining stock**; say whether any UB item grants a role on use.
5. **Holdings CSV:** list current UB item holders by hand (`discordId,item,qty`); keep it private.
6. **UB leaderboard must be public** at export time; **reset UB by hand** (`/reset-economy`) or remove UB after the import.
7. **Discord application settings:** Interactions Endpoint URL = `https://app.pizzadao.org/api/discord/interactions`; Vercel env `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `PEP_EMOJI` (and `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, already used by the app). If the PizzaDAO application already serves interactions another way, use a new application.
8. **Flags**, when ready: `PEP_MIGRATION_CLAIMS=1`, `PEP_CRIME_ENABLED=1`, `PEP_GAMES_ENABLED=1`. Optional tuning: `ROLE_INCOME_JSON`, `GAME_*`, `BLACKJACK_TIMEOUT_SECONDS`.
9. A private archive location for the snapshot and audit files, and optionally a `UB_SNAPSHOT_SIGNING_KEY` kept offline.

## 10. Decisions

| Decision | Status |
|---|---|
| Rate | **1 UB (cash + bank) = 1 PEP** (decided) |
| Negative balances | **Forgive** (decided) |
| Export path | **Public leaderboard, no token** (decided) |
| `/rob` | **Removed** (owner decision, 2026-10-03) |
| `/slut` | **Drop** (decided) |
| Games | **Blackjack, roulette, slots** (decided) |
| Store | **Move the 4 items** (decided) |
| Inventory migration | Manual CSV + `grant-items.mjs` (no token) |
| Crime | Web only, launch with the card (`PEP_CRIME_ENABLED`) |
| Pending-claim expiry | Open. Recommended: none |
| Users who left the server | Hold like any non-member |
| /work prompts source | Open. Recommended: sheet tab (today `WORK_PROMPTS_JSON`) |
| Bonus payouts for /work missions | `/add-money` (built, §7.7) |
| Chat money | Stay off |

## 11. Running the migration (cheat sheet)

```bash
# 0. once: migrations (Neon branch first, then prod)
npx prisma migrate deploy

# 1. store: print Shop-tab rows (and optionally create the items)
DATABASE_URL=... node scripts/unbelievaboat/seed-store.mjs --rare-box-stock N [--apply]

# 2. export, no token (UB leaderboard must be public). Writes scripts/unbelievaboat/snapshots/ (gitignored)
DISCORD_GUILD_ID=812097286003359764 UB_SNAPSHOT_SIGNING_KEY=... \
  node scripts/unbelievaboat/export.mjs --public

# 3. dry run (Crew sheet → File › Download › CSV)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --members crew.csv [--exclude bots.txt]

# 4. apply (N = "PEP total to mint" from the dry run)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --members crew.csv --apply --confirm-total N

# 5. item holdings (hand-made CSV discordId,item,qty)
DATABASE_URL=... node scripts/unbelievaboat/grant-items.mjs --csv holdings.csv          # dry run
DATABASE_URL=... node scripts/unbelievaboat/grant-items.mjs --csv holdings.csv --apply

# 6. enable login claims: set PEP_MIGRATION_CLAIMS=1 in Vercel; reset UB by hand (/reset-economy)

# 7. slash commands (after UB is frozen)
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=812097286003359764 \
  node scripts/discord/register-commands.mjs --apply

# 8. flags when ready: PEP_CRIME_ENABLED=1, PEP_GAMES_ENABLED=1

# health check any time (read-only)
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -f scripts/pep-reconcile.sql

# rollback (balances, before UB is reset)
DATABASE_URL=... node scripts/unbelievaboat/import.mjs --snapshot <snap>.json --rollback --confirm-rollback
```

The public leaderboard endpoint was re-verified on 2026-10-03 with one unauthenticated request: `GET https://unbelievaboat.com/api/guilds/812097286003359764/leaderboard?limit=25&page=1` → 200, `{ balances: [{rank (string), user_id, cash, bank, total}], users: [{id, avatar, bot, username, discriminator}], page, total_pages }`, 25 per page, 11 pages. Nothing from the response was saved.

The scripts need Node ≥ 22.18. They re-exec themselves with `--experimental-transform-types` and a small resolve hook (`scripts/unbelievaboat/run-ts.mjs`), so they run the app's own TypeScript and credit through the same code paths as the app.

## 12. Files

| Path | What |
|---|---|
| `app/lib/unbelievaboat/*` | #134: UB client (token + public), snapshot, plan, claims, reconcile, Discord lookup |
| `scripts/unbelievaboat/{export,import,zero-balances}.mjs` | #134 CLIs (dry-run by default; `zero-balances` needs a token, so it's unused now) |
| `scripts/unbelievaboat/seed-store.mjs` | Shop-tab rows + optional DB create for UB's 4 items |
| `scripts/unbelievaboat/grant-items.mjs` | Manual, idempotent grants of UB holdings |
| `app/lib/shop-grants.ts` | CSV parsing, grant planning and apply (`ItemGrant`) |
| `app/lib/pep-earn/{cooldown,work,crime}.ts` | #134: cooldowns, `/work`, crime |
| `app/lib/pep-earn/income.ts` | Role income table, name→id resolution, `collectIncome()` |
| `app/lib/pep-earn/rng.ts` | crypto RNG helpers |
| `app/lib/pep-games/{config,roulette,slots,blackjack}.ts` | Games |
| `app/lib/discord-interactions/{verify,commands,handle,guild-roles,embeds}.ts` | Verification, command definitions, dispatch (commands, buttons, autocomplete), cached guild roles, UB-style reply embeds |
| `app/lib/pep-admin.ts` | `/add-money`, `/remove-money` |
| `app/api/discord/interactions/route.ts` | Interactions endpoint |
| `app/api/economy/crime/route.ts` | Web crime (`PEP_CRIME_ENABLED`) |
| `app/api/economy/features/route.ts` | Which flagged features are on |
| `app/api/economy/games/{slots,roulette,blackjack}/route.ts` | Web games (`PEP_GAMES_ENABLED`) |
| `app/ui/economy/{CrimeCard,GamesCard}.tsx` | `/pep` cards |
| `scripts/discord/register-commands.mjs` | Guild command registration (dry-run by default) |
| `scripts/pep-reconcile.sql` | Read-only health checks (now with the new types' signs and a blackjack payout check) |
| `app/lib/pep-economy.concurrency.test.ts` | Real-Postgres race tests (`npm run test:pep-concurrency`) |
| `prisma/migrations/20261003000000_pep_migration_and_earning` | #134: `PendingPepClaim`, `EconomyCooldown`, enum values |
| `prisma/migrations/20261005000000_admin_grant_types` | `TransactionType` += `ADMIN_GRANT`, `ADMIN_REMOVE` |
| `prisma/migrations/20261004000000_pep_discord_economy` | `EconomyPeaceMode` (unused since /rob was removed), `BlackjackGame` (+ `BlackjackStatus`), `ItemGrant`; `TransactionType` += `ROLE_INCOME`, `ROB_STEAL`, `ROB_LOSS`, `ROB_FINE` (legacy), `GAME_BET`, `GAME_WIN` |

## Appendix: current UnbelievaBoat role income (read from the UB dashboard, 2026-10-03)

All are *collectable* (via `/collect-income`), once per **1 day**, into the single $PEP wallet:

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
