# PizzaDAO Trivia: Discord bot + pizzadao.org/trivia + vetted question bank

**Status:** decisions approved by Snax (2026-11-18, §13). Phase 1 implemented on branch `oregano-27514-trivia` (task `oregano-27514`); phases 2-3 not started.
**Question bank:** [`data/trivia/questions.json`](../data/trivia/questions.json) (moved from `plans/` in phase 1): 95 entries (90 approved, 4 flagged, 1 rejected), each with sources. `fun-002` was approved by Snax; each approved entry carries a `pool` (see §8.1).
**Owner repo:** `PizzaDAO/pizzadao-org` (this repo). It serves `pizzadao.org` today (`app.pizzadao.org` 307s to the apex), runs the $PEP economy, the Discord HTTP-interactions bot and the Railway gateway worker (`recorder/`, "Metalhead").

> Local checkout note: the local `main` is ~174 commits behind `origin/main`. The implementer must branch from `origin/main`.
> Every file path below refers to `origin/main`.

## 1. Goal

1. **Discord:** a Volt-style loop in the PizzaDAO server. The bot posts
   "🎲 Trivia Time! First to answer correctly wins N $PEP:" plus a question. The first member to *type* a correct answer
   gets "✅ Correct! @user wins N $PEP!". Typos are tolerated ("Trie" counts as "True").
2. **Web:** `pizzadao.org/trivia` with the same questions: a daily question, solo practice and a leaderboard.
3. **Question bank:** vetted, sourced and versioned. Every fact links to a primary or reputable source, and disputed facts are worded around the dispute.

## 2. What exists today (findings)

| Thing | Where | Relevance |
|---|---|---|
| pizzadao.org apex | Vercel project `onboarding` (this repo). `dig pizzadao.org` → Vercel; `/pep`, `/start`, `/about` are served by the Next app | `/trivia` = `app/trivia/` here. The Lovable/Vite `pizzadao-site` no longer serves the apex (see `plans/pizzadao-org-to-vercel.md`) |
| Discord slash commands | `app/api/discord/interactions/route.ts` + `app/lib/discord-interactions/*` (HTTP interactions on Vercel, `commands.ts`, `scripts/discord/register-commands.mjs`) | Host for `/trivia` admin and leaderboard commands. **It cannot see plain chat messages** (HTTP interactions only) |
| Gateway bot | `recorder/` on Railway, same bot token. Already listens to `messageCreate` with `GuildMessages` (+ `MessageContent` when `CAPTURE_VOICE_CHAT`, default on). Talks to the app with `Authorization: Bearer RECORDER_API_KEY` (`app/lib/calls/recorder-auth.ts`), pulls admin settings from `GET /api/calls/recorder/config` (`recorder/src/remote-config.ts`) | Host for the "type the answer" listener. No new bot or token needed |
| Reward currency | **$PEP**: `Economy.wallet` + `Transaction` ledger, `creditInTx()` in `app/lib/economy.ts`, `TransactionType` enum. The handbook calls it "PEP, the community's points". `/work` pays 10–100 every 30 s; supply ~350k (HANDOFF, Oct 2026) | Reward unit. **`toppings` is not a currency**: it's the Rare Pizzas NFT art/marketplace site (rarepizzas.com) |
| Settings / kill switches | `app/lib/settings/*` (registry, `economy-settings.ts` stricter-only payout knobs, `toggles.ts`: env kill switch, OFF if settings unreadable, **previews ignore saved rows**) | Trivia flags and payout amount |
| Cron | `vercel.json` crons + `isCronAuthorized` (`app/lib/cron-auth.ts`) | Question poster / round expiry |
| Bot REST posting | `postDiscordMessage` in `app/lib/discord-rest.ts` | Question, winner and reveal posts |
| Rate limits | `checkKeyedRateLimit` in `app/lib/rate-limit.ts` (Upstash) | Per-user attempt limits |
| Concurrency tests | `app/lib/pep-economy.concurrency.test.ts` | Pattern for the first-correct-wins race test |

**Important:** previews share the production database (`STAGING.md`, `toggles.ts`). Every trivia path that posts or pays must be a toggle that is OFF on previews.

## 3. Question bank

### 3.1 Format (`data/trivia/questions.json`)

```jsonc
{
  "id": "pd-001",                 // stable forever; rounds and stats reference it
  "category": "pizza-day | jercos | early-bitcoin | satoshi | protocol | myth-busting | pizzadao | just-for-fun",
  "type": "true_false | short_answer | multiple_choice",
  "difficulty": "easy | medium | hard",
  "question": "...", "choices": ["..."],   // choices: multiple_choice only
  "answer": "canonical", "aliases": ["..."], "rejects": ["near-misses that must never match"],
  "match": { "kind": "boolean | number | text | choice", "fuzzy": true, "tolerance": 0 },
  "explanation": "shown after the round / answer, includes the key quote",
  "sources": [{ "url": "https://...", "note": "what this source proves" }],
  "notes": "disagreements, wording constraints",
  "label": "optional banner, e.g. 🍍 Just for fun (meme, not history)",
  "validUntil": "optional ISO date: auto-retire after it",
  "status": "approved | flagged | needs_snax | rejected",
  "pool": "discord | web"        // approved only: where it may be served, see §8.1. fun-* / just-for-fun are always "web"
}
```

Only `approved` questions are served. `flagged` = fact not solid enough for rewards; `needs_snax` = wording decision; `rejected` = kept so it isn't re-added.

### 3.2 What's in the bank (summary)

| Category | Approved | Examples |
|---|---:|---|
| pizza-day (Laszlo) | 19 | 10,000 BTC; May 22; Jacksonville; "Pizza for bitcoins?"; block 57,043; 131 inputs; 0.99 BTC fee; GPU pioneer; first Mac OS X client; Lightning pizza 2018 |
| jercos | 6 | username; Jeremy Sturdivant; paid with his card; remembered Domino's but photos show Papa John's; spent coins when worth ~$400 |
| early-bitcoin | 27 | whitepaper title, date (Oct 31 2008), 9 pages, refs (b-money/Wei Dai, Hashcash), no 21M in paper; genesis block, Times headline, unspendable 50 BTC; Hal's "Running bitcoin", block 170, 10 BTC; v0.1 Windows-only, 21,000,000; bitcoin.org Aug 2008; value overflow (184 billion, block 74,638, fix within ~5 h); Mt. Gox (name, McCaleb, Karpelès, 2014, >70%) |
| satoshi | 7 | last post Dec 2010 / 0.3.19; "moved on to other things"; lost coins quote; identity unknown; satoshin@gmx.com; unit named after him |
| protocol | 11 | 50 BTC; 210,000 blocks; 2012; 3.125 (validUntil 2028); 840,000; 2016 blocks; 10 min; 100M sats; ~2140; 20,999,999.9769 |
| myth-busting | 3 | "Satoshi said bit = BitTorrent" (False); "bit" = binary digit; "real Satoshi email says pineapple-jalapeño" (False) |
| pizzadao | 16 | Global Pizza Party; first in 2021; Slice 2021; 10,000 Rare Pizzas; "global bake sale"; 51% to pizzerias; 300+ artists; 0.08 ETH box; Ethereum; PEP; mafia name; 2025: 400+ cities, six continents, Base/Unlock, >$1M given away |

That is 89 approved entries (90 with `fun-002`, approved by Snax), more than the 60–80 target, so launch with the best ~70 and keep the rest as reserves. Mix: 58 short answer, 18 true/false, 13 multiple choice; 23 easy, 49 medium, 17 hard.

### 3.3 "What does the 'bit' in Bitcoin stand for? BitTorrent": **not usable as written**

- **No sourcing.**
  - The whitepaper (checked full text) never explains the name or mentions BitTorrent.
  - Neither does the v0.1 release email.
  - Searches turned up no Satoshi statement or credible article linking the name to BitTorrent.
- **"Bit" is the unit of information.** It's short for "binary digit". Shannon's 1948 paper credits the word to John Tukey:
  "binary digits, or more briefly bits, a word suggested by J. W. Tukey".
- **Not PizzaDAO lore.** `BitTorrent` appears nowhere in `rare-pizzas`, `pizzadao-org` (incl. git history), `pizzadao-site` or `toppings`.
- **Truthful replacements** (in the bank):
  - `mb-001`: "True or false: Satoshi said the 'bit' in Bitcoin comes from BitTorrent." → **False**
  - `mb-002`: "'Bit' is short for what two words?" → **binary digit**
- The original is kept as `bt-000` with `status: rejected`.
- Accurate framing if anyone asks: Satoshi never explained the name.
  - "Bit" (binary digit) + "coin" is the plain reading.
  - "BitTorrent" is a myth, or at best a guess.

### 3.4 "What was Satoshi's favorite slice? Pineapple jalapeño": **a 2024 fake, not history, and not PizzaDAO lore**

- **Real sourcing: none.** It's a known fabrication.
  - On Feb 23, 2024, Martti Malmi published his real Satoshi emails. Within days, a fake email "persuaded most of crypto Twitter that Satoshi liked pineapple and jalapeños on his pizza" (Fortune, Feb 26 2024).
  - Unchained ran the quote and then corrected it: "This was a meme post and not a true quote."
- **Repos:** no Satoshi link. The only hits are generic topping lists (`app/lib/topping-images.ts`, `app/lib/themed-name.ts`) and one 2025 GPP event in Catania titled "Pineapple and jalapenos is a good pizza topping" (`data/gpp-contracts.json`).
- **Handling** (per Snax/coordinator):
  - Kept in a clearly labeled **just-for-fun** category. The Discord post and web card show the banner
    "🍍 Just for fun (crypto-Twitter meme, not history)".
  - `fun-002`: "Just for fun: a fake 'Satoshi email' went viral in 2024. What did it claim was Satoshi's favorite slice?" → pineapple jalapeño. Status `needs_snax`, so Snax can confirm the wording.
  - `fun-001` is the myth-buster ("True or false: a real Satoshi email reveals… pineapple and jalapeño" → False).
  - Snax's literal wording ("What was Satoshi's favorite slice?") is **not** used, because it states a fabricated quote as fact.

### 3.5 Disagreements found (questions are worded around these)

| Fact | Disagreement | Handling |
|---|---|---|
| Pizza price | Laszlo: "about 25 dollars total, maybe 30 if you give the guy a nice tip"; BTC value quoted at $41; articles mix these up | T/F on Laszlo's own words; MC "according to the Bitcoin Wiki… $41" |
| Pizza chain | Photos and Wikipedia: Papa John's. jercos (2016): "I clearly remember Domino's… but the pictures show Papa John's" | Ask what the *photos* show; separate T/F about his memory; "Domino's" in `rejects` |
| Laszlo's later pizzas | ~80,000 BTC (forum posts) vs 81,432 BTC in payments vs "closer to 100,000" (interview) | Never ask a total; T/F "not his only purchase" |
| Time of the order | Forum timestamps render in the viewer's timezone. Block 57,043 = 2010-05-22 18:16:31 UTC | Only ask the date / block |
| jercos's age | 18 or 19 | Not asked |
| GPU mining | "Invented" vs Laszlo saying Satoshi had GPU code first | Worded "pioneer" |
| Whitepaper date | Mail-archive mirror stamps Nov 1 2008 (-0700). List archive / Nakamoto Institute: Oct 31 2008 18:10 UTC | Answer Oct 31; Nov 1 rejected; explanation says why |
| Hal's tweet | Jan 10 vs Jan 11 2009 (timezone) | Ask the words, not the date |
| Overflow bug | bitcoin.it: 3 addresses; Wikipedia: 2 outputs of ~92.2 B | Ask only the ~184 B total (±1 B) |
| Satoshi's last email | Apr 23 vs Apr 26 2011 | Ask the words / month only |
| 2024 halving | Apr 20 UTC = Apr 19 in the Americas | Ask the block height |
| Rare Pizzas toppings | Press and site: 314 (17 classes). `toppings/src/data/toppings.json`: 339 rows, 19 classes | `pz-008` flagged for Snax |

### 3.6 Could not verify (flagged or dropped)

- `eb-035` Who coined "satoshi" (ribuck vs marcus_of_augustus): secondary sources only. **Flagged.**
- `eb-036` "I am not Dorian Nakamoto" (2014): the text and date are verified, but not whether Satoshi wrote it. **Flagged**, worded as "a post on Satoshi's P2P Foundation account".
- `eb-037` New Liberty Standard's 1,309.03 BTC/$ (Oct 2009): no primary source survives (Bitbo). **Flagged.**
- `pz-008` 314 toppings vs repo's 339. **Flagged.**
- 2018 Lightning pizza amount (0.00649 BTC): one secondary source. The amount isn't asked; the network is.
- **Dropped:**
  - Laszlo's total BTC spent on pizza.
  - Satoshi's coin holdings (estimates of 750k–1.1M).
  - PizzaDAO's exact founding date: no source states it. Rare Pizzas "born Feb 18, 2021" comes from a single translated article.
  - Hal's tweet date.
  - jercos's age and location.
- X (`x.com/halfin/...`) blocks fetches. The tweet text is confirmed through coverage (Cointelegraph, Decrypt).

### 3.7 Time-sensitive and ambiguous rules (enforced by the validator, §11)

- No "current price / current count" questions.
- Counts carry a year in the question ("the 2025 Global Pizza Party…").
- Facts that will change get `validUntil` (e.g. `pr-004` subsidy 3.125 → retire by 2028). The server skips expired questions, and a CI test fails within 60 days of any `validUntil`, so someone re-checks it.
- Dates are only asked where sources agree, and the accepted formats are listed as aliases. There is no free-form date parser.
- Identity, speculation and "who is Satoshi" questions only in the form "is it confirmed?" (False), and re-checked each season.

## 4. Architecture

```
data/trivia/questions.json  ──(build-time import, zod-validated)──►  app/lib/trivia/bank.ts
                                                                       │
 Vercel cron /api/cron/trivia ──► rounds.ts: pick question, open round ─┤──► postDiscordMessage (#trivia)
                                                                       │
 recorder (Railway gateway) ──messageCreate in #trivia──► POST /api/trivia/discord/answer (RECORDER_API_KEY)
                                                                       │       └─► match.ts → claimWin (atomic) → creditInTx(TRIVIA_REWARD) → reply
 web /trivia ──► /api/trivia/daily, /api/trivia/practice, /api/trivia/leaderboard (never returns answers before an attempt)
 Discord /trivia (HTTP interactions) ──► start / skip / leaderboard / stats
```

**Storage decision:**
- **Questions:** a JSON file in git (reviewed in PRs = the moderation log, diffable, works without a DB), plus a DB-side per-question kill list (setting `trivia.disabledQuestionIds`) so a bad question can be pulled in seconds without a deploy.
- **Runtime state:** Postgres (Neon via Prisma).
- **Alternatives considered:**
  - (a) DB-only questions with an admin editor: better for non-developers, but loses review-by-PR and needs an approval workflow on day one. Moved to phase 4.
  - (b) Google Sheet like the bounties: easy to edit, but unvalidated and slow. Rejected.

### 4.1 Prisma models (one migration, `prisma/migrations/2026xxxx_trivia`)

```prisma
enum TriviaRoundStatus { OPEN WON EXPIRED CANCELLED }
enum TriviaSurface { DISCORD WEB_DAILY }

model TriviaRound {
  id               Int               @id @default(autoincrement())
  surface          TriviaSurface
  questionId       String
  status           TriviaRoundStatus @default(OPEN)
  channelId        String?           // Discord channel
  messageId        String?   @unique // the bot's question post (snowflake)
  dayKey           String?   @unique // WEB_DAILY: 'YYYY-MM-DD' (UTC)
  rewardPep        Int               @default(0)
  openedAt         DateTime          @default(now())
  closesAt         DateTime
  winnerDiscordId  String?
  winnerMessageId  String?
  wonAt            DateTime?
  @@index([surface, status])
  @@index([questionId])
}

model TriviaAttempt {
  id          Int      @id @default(autoincrement())
  roundId     Int
  discordId   String
  messageId   String?  @unique   // Discord: idempotency for recorder retries
  correct     Boolean
  answerText  String   @db.VarChar(120) // truncated; kept 30 days, then nulled by the scrub cron
  createdAt   DateTime @default(now())
  @@unique([roundId, discordId, messageId])
  @@index([roundId, discordId])
  @@index([discordId, createdAt])
}

model TriviaReport { id Int @id @default(autoincrement()); questionId String; discordId String?; text String @db.VarChar(500); status String @default("open"); createdAt DateTime @default(now()) }
```

- Add `TRIVIA_REWARD` to `enum TransactionType` (as an `ALTER TYPE … ADD VALUE` migration). Phase 1 ships it as `prisma/migrations/20261223090000_trivia/migration.sql`, tested on a throwaway local Postgres 17 (old schema pushed, migration applied in one transaction, `prisma migrate diff` against the new schema is empty); no neonctl branch was used, and it is **applied to production by hand before the merge** (previews share the production database). The migration also adds the two partial unique indexes mentioned above and a cascade foreign key from `TriviaAttempt.roundId`.
- Web daily answers are `TriviaAttempt` rows on the day's `WEB_DAILY` round, with `@@unique([roundId, discordId])` enforced in code (`messageId` null).
- Leaderboards are SQL aggregates over `TriviaRound` (wins) and `TriviaAttempt` (daily streaks). There's no denormalized score table until it's needed.

### 4.2 Files

| File | Purpose |
|---|---|
| `data/trivia/questions.json` | Bank (moved from `plans/trivia-questions.json`) |
| `app/lib/trivia/schema.ts` | zod schema + types for the bank |
| `app/lib/trivia/bank.ts` | Load + validate once; `servable(now, settings)` filters status/validUntil/disabled ids; `publicView(q)` strips `answer/aliases/rejects` |
| `app/lib/trivia/match.ts` | Pure matcher (§5). No I/O |
| `app/lib/trivia/rounds.ts` | `pickQuestion`, `openDiscordRound`, `claimWin`, `expireRounds`, `openDailyRound` |
| `app/lib/trivia/post.ts` | Discord message builders (question, winner, reveal, labels) |
| `app/lib/trivia/leaderboard.ts` | Aggregates |
| `app/lib/settings/trivia-settings.ts` | Settings group (§6) + register in registry |
| `app/api/cron/trivia/route.ts` | Every 5 min: expire, then maybe post (§6) |
| `app/api/trivia/discord/answer/route.ts` | Recorder-auth'd answer intake |
| `app/api/trivia/daily/route.ts` | GET today's question (public view); POST answer (session required) |
| `app/api/trivia/practice/route.ts` | GET random practice question; POST check (rate-limited) |
| `app/api/trivia/leaderboard/route.ts` | GET (CDN-cacheable 60 s) |
| `app/api/trivia/report/route.ts` | POST "report a problem" |
| `app/trivia/page.tsx` + `app/trivia/_components/*` | Web UI (§8) |
| `app/admin/trivia/page.tsx` | Rounds, reports, disable toggle, bank stats |
| `app/lib/discord-interactions/commands.ts`, `handle.ts`, new `trivia-command.ts` | `/trivia` subcommands |
| `app/api/calls/recorder/config` + `app/lib/calls/recorder-config.ts` | Add `trivia: { enabled, channelIds }` |
| `recorder/src/trivia-forward.ts` (+ test), `recorder/src/index.ts`, `recorder/src/remote-config.ts` | Listener (§7) |
| `vercel.json` | `{ "path": "/api/cron/trivia", "schedule": "*/5 * * * *" }` |
| `app/sitemap.ts`, marketing nav/footer, `messages/{en,es,fr}.json` | Link + UI strings |

## 5. Answer matching (`app/lib/trivia/match.ts`)

`match(question, raw) → { verdict: 'correct' | 'wrong' | 'ignore' }`. `ignore` = not an answer attempt (chit-chat), so it doesn't use up an attempt.

1. **Pre-filter:**
   - Strip bot mentions and the `<@…>`, `<#…>`, `<:emoji:id>` and URL syntax. Remove Discord markdown (`**`, `||spoiler||`, backticks).
   - Messages over 80 characters, or with more than 8 tokens, are `ignore` (chat, not an answer). This prevents answer-dumping.
2. **Normalize:**
   - Unicode NFKD, strip diacritics (`Karpelès` → `karpeles`, `jalapeño` → `jalapeno`), lowercase.
   - Unify quotes and apostrophes, drop the possessive `'s` (`papa john's` → `papa johns` and `papa john`), `&` → `and`.
   - Strip leading filler (`it's`, `its`, `i think`, `answer:`, `the`, `a`, `an`) and trailing punctuation or emoji. Collapse whitespace.
3. **By `match.kind`:**
   - **boolean:**
     - true: `true, t, yes, y, yep, yeah, correct, right, ✅, 👍`
     - false: `false, f, no, n, nope, wrong, incorrect, ❌, 👎`
     - Fuzzy is Damerau-Levenshtein ≤ 1 against `true`/`false` only (`trie`, `ture`, `flase`, `fasle`, `fales`).
     - Anything else is `ignore`.
   - **number:**
     - Parse: digit groups with `,` `.` `_` or spaces as thousands separators (`9,900`, `9.900`, `9 900`) when the groups are exactly 3 digits. A single `.`/`,` followed by 1–2 digits, or by more than 3, is a decimal.
     - Suffixes `k`/`m`/`b`/`thousand`/`million`/`billion`, `e8`, `10^8`. Strip `$`, `btc`, `bitcoin(s)`, `sats`, `%`, `eth`.
     - Number words up to "one hundred million" via a small table.
     - Correct if `|n − answer| ≤ tolerance`. **Never fuzzy on digits**, so 9,800 ≠ 9,900.
     - No number found → `ignore`.
   - **choice:**
     - Accept a letter (`b`, `(b)`, `b)`, `b.`, `option b`) for the choice index, or the choice text / alias through the text matcher.
     - On Discord the post lists choices as 🅰️–🅳.
   - **text:**
     1. `rejects` first: an exact or fuzzy (≤ 1) match → `wrong`. This beats aliases.
     2. Exact match against `answer` + `aliases` (normalized) → `correct`.
     3. If `fuzzy`: Damerau-Levenshtein against each target. Threshold:
        - length ≤ 4 → exact only
        - 5–8 → 1
        - 9–15 → 2
        - more than 15 → 3
     4. Containment: the input contains a target as a whole-word sequence, has at most 3 extra tokens, and has no negation token (`not`, `isn't`, `wasn't`, `no`, `never`) → `correct` ("it was jercos!").
     5. Otherwise `wrong` (a wrong guess counts as an attempt).
4. **Tests** (`match.test.ts`, table-driven *from the bank*):
   - Every alias of every question matches; every reject fails.
   - Volt's case: `Trie` and `True` both match true.
   - `9,900`/`9900`/`9 900`/`9.9k` all equal 9900; `10.000` = 10000; `0.99` ≠ `99`.
   - `184 billion` passes `eb-020`; `domino's` fails `pd-004`; `not hal finney` fails `eb-013`.
   - A fuzz test checks that the matcher never throws on random Unicode.

**Alternative considered:** an LLM judge for free text (the app already has `ai` + `@ai-sdk/openai`). Rejected for v1: it's non-deterministic, has latency inside a race, costs money per message, and can be prompt-injected by the very messages it judges. Possible later as an *admin-review* aid for disputed answers only.

## 6. Cadence, rounds and anti-spam

**Settings group `trivia.*`** (admin page; payout knobs stricter-only like `economy-settings.ts`):

| Key | Default | Notes |
|---|---|---|
| `trivia.discordEnabled` (toggle, env `TRIVIA_DISCORD`) | off | Master switch for posting + paying in Discord. OFF on previews |
| `trivia.channelId` | none | **Snax decision** (§12) |
| `trivia.roundsPerDay` | 3 | Posted at random minutes inside `trivia.windowsUtc` |
| `trivia.windowsUtc` | `["14:00-16:00","18:00-20:00","23:00-01:00"]` | Spread across US/EU/Asia evenings. The cron picks a random slot inside each window once per day (seeded by date, so reruns are stable) |
| `trivia.roundMinutes` | 10 | Then reveal: "⏰ Time's up! The answer was **X**." + explanation + source link |
| `trivia.rewardPep` | 20 (cap 50) | Volt-equivalent. Optional difficulty multiplier (`easy ×1, medium ×1.5, hard ×2`) behind `trivia.difficultyMultiplier` |
| `trivia.maxWinsPerUserPerDay` | 3 | A 4th correct answer still wins, but announces "(daily $PEP cap reached)" and pays 0, or the round stays open for others (**Snax**) |
| `trivia.attemptsPerRound` | T/F and MC: **1**; short answer: **3** | Without this, T/F and MC are free money: answer "true" then "false" |
| `trivia.requireMember` | true | Only onboarded members (`fetchMemberIdByDiscordId`) can win. Others get "✅ Correct! Join at pizzadao.org/join to collect $PEP next time", with no payout. Anti-sybil |
| `trivia.minAccountAgeDays` | 7 | Discord snowflake → account creation date. Mirrors the mission verifier's young-account caution |
| `trivia.disabledQuestionIds` | [] | Instant pull |
| `trivia.webDailyRewardPep` | 0 | **Snax decision** |

**Cron `/api/cron/trivia` (every 5 min):**
1. Expire OPEN Discord rounds past `closesAt`: set status EXPIRED and post the reveal.
2. If no round is open and a scheduled slot ≤ now hasn't fired today, open one.
   - `pickQuestion`: random among servable questions not used in Discord in the last `N = floor(servable × 0.8)` rounds, weighted 40% easy, 45% medium, 15% hard.
   - `fun-*` questions at most once a week.
3. Ensure today's WEB_DAILY round exists (`dayKey` unique, so repeat runs are harmless). It's picked from questions **already used in Discord** (§8 explains why).
4. Two crons racing: the open step is guarded with a Postgres advisory lock (`pg_try_advisory_xact_lock(hashtext('trivia-open'))`) plus a partial unique index "at most one OPEN DISCORD round per channel" (raw SQL in the migration).

**Discord post format:**
```
🎲 Trivia Time! First to answer correctly wins 20 $PEP:
**How many bitcoins did Laszlo Hanyecz pay for two pizzas in May 2010?**
(short answer · easy · 10 min)
```
- Just-for-fun questions are prefixed with their `label` line.
- MC questions list choices on lines 🅰️ 🅱️ 🅲 🅳.
- `allowed_mentions: { parse: [] }`.

**Anti-spam:**
- The bot is ignored, as are other bots and webhooks.
- Per user per round: the attempt cap above, plus at most 1 message per 2 s (`checkKeyedRateLimit('trivia-msg', id)`); extra messages are ignored silently.
- Recommend Discord **slowmode 3 s** on the trivia channel (Snax sets it).
- Wrong answers get no reply (keeps the channel readable). Optional ❌ reaction behind `trivia.reactWrong` (default off; reactions cost API calls).
- Answers sent before the question's snowflake, or edited messages, don't count. Only `messageCreate` is forwarded.

## 7. First-correct-wins race handling

**Ordering:**
- Discord delivers a channel's gateway events in order.
- The recorder forwards trivia messages through a **per-channel serial queue** (its own `chain`, separate from the recording `serial()` queue, so trivia can never delay recording), and awaits each POST before sending the next.
- So the app sees answers in Discord order. Retries keep order (the queue blocks until success or a permanent error).

**Atomic claim** (`claimWin`, one DB transaction):
1. Insert `TriviaAttempt` (unique `messageId`; a duplicate means it's a retry, so return the stored verdict).
2. Check attempt caps (`count(*) where roundId, discordId`).
3. If correct:
   ```sql
   UPDATE "TriviaRound"
   SET status='WON', "winnerDiscordId"=$1, "winnerMessageId"=$2, "wonAt"=now()
   WHERE id=$3 AND status='OPEN' AND "closesAt" > now()
   ```
   `count = 1` → winner; `0` → late (someone already won), recorded as correct-but-late.
4. Winner + reward > 0 + eligible: `getOrCreateEconomy` (before the tx, as `doWork` does) → `creditInTx(tx, id, amount, 'TRIVIA_REWARD', 'Trivia win', { roundId, questionId })`. The round row's single winner *is* the idempotency key, so there's no double pay.

**Tie-break safety net:**
- If two correct answers arrive within the same 1 s, the app compares snowflakes: the winner must have the smallest snowflake among correct attempts.
- Because of the serial queue this should never trigger. It's logged loudly if it does, and the admin page shows it.

**Reply:**
- In `after()`, post `✅ Correct! <@id> wins 20 $PEP!` as a reply (`message_reference`) to the winning message, with `allowed_mentions: { users: [id] }`.
- Then the explanation + source link (one message).
- A failed post is logged and the payout stands.

**Alternatives considered:**
- **(a) HTTP-interactions only:** `/answer text:` slash command, or buttons for MC/T-F.
  - No gateway or MessageContent needed; runs entirely on Vercel.
  - But it isn't the Volt UX ("just type it"), buttons expose the options, and the 3 s deadline applies.
  - **Kept as the fallback** if MessageContent is unavailable: `/trivia answer` reuses the same `claimWin`.
- **(b) A new standalone bot service:** a second token, deploy and health check for one feature. Rejected; the recorder already holds the gateway connection with these intents.
- **(c) Matching inside the recorder:** saves a round-trip, but splits the source of truth (bank, settings, caps). Rejected; the recorder stays a thin forwarder. It only drops non-trivia channels, bots, and messages over 80 characters.

## 8. Web UX: `pizzadao.org/trivia`

The page sits in the marketing style of the current site and works logged out.

1. **Today's question** (hero card):
   - The same question for everyone, UTC day. Countdown to the next one.
   - **One attempt per Discord-logged-in user** (existing session cookie, `verifySession`). Logged-out users can answer for fun; nothing is recorded and they see "Sign in with Discord to keep your streak".
   - After answering: correct/wrong, canonical answer, explanation, source links, and "X% of players got this".
   - **Daily streak** shown for logged-in users.
2. **Practice** (solo, unlimited, no rewards):
   - 10 random questions, filterable by category (Bitcoin Pizza Day / Early Bitcoin / Satoshi / PizzaDAO / Just for fun).
   - Instant feedback with sources. Score at the end + "Share" (OG image `app/trivia/opengraph-image.tsx`).
3. **Leaderboard:** Discord wins (all-time / this month) and daily streaks, using mafia names via the existing member display-name helpers. Top 25.
4. **"Report a problem with this question"** on every revealed question → `TriviaReport`, visible in `/admin/trivia`.
5. **How to play in Discord** card with a channel link.

**Answer secrecy (important for Discord rewards):**
- The API never sends `answer`/`aliases` before an attempt (`publicView`).
- Practice and the web daily draw **only from the `web` pool**; questions in the `discord` pool are never served on the web, so nobody can farm Discord answers from the site (§8.1). This replaces the original "only questions already used in Discord" rule, which would leave the web empty before the Discord loop exists.
- Practice checks are server-side, rate-limited at 30/min per IP and user.

### 8.1 Discord / web split (phase 1)

Every approved question has an explicit `pool` field in the bank:

- **`discord`**: reserved for the Discord rounds (phase 2). Never served by the practice, daily, report or any other web API. 27 questions at launch, about 30%: enough for 9 days of 3 rounds a day without a repeat.
- **`web`**: practice and the web daily only. 63 questions.
- **Fun questions** (`fun-*` ids, category `just-for-fun`) are always `web`: never in paid rounds (Snax, §13.7). The schema fails the build if one is marked `discord`.
- **How it was assigned:** once, by a script: within each category, sorted by id, every 3rd question (index 2, 5, 8...) went to `discord`, so every category has a Discord share. The result is written into the JSON and **never re-derived**: a question keeps its pool forever (a re-derivation would move questions when ids are added). New questions are assigned by hand in the PR that adds them (default `web`; a reviewer moves roughly every 3rd to `discord`).
- **Once a Discord question has been asked and revealed** it is public anyway; a later phase may "retire" it into `web`, by editing its `pool` in a PR. Phase 1 does not do this.
- `bank.test.ts` enforces: pools never overlap, fun questions are web only, about a third of the bank is `discord`, every category has a Discord share, and the APIs never return a `discord` question (`trivia-api.test.ts`).

**i18n:** UI strings in `messages/{en,es,fr}.json`. Questions are English-only in v1; a `translations` field is a later addition.

## 9. Scoring and leaderboard

- **Discord win** = `rewardPep` $PEP (ledger `TRIVIA_REWARD`) + 1 win on the leaderboard.
- **Web daily** = streak + leaderboard; $PEP only if Snax turns on `trivia.webDailyRewardPep` (suggest 5).
- **`/trivia leaderboard`** (Discord, ephemeral or public by option) and the web leaderboard share `leaderboard.ts`.
- **`/leaderboard`** (the existing $PEP wealth board) is unchanged.
- **Budget at defaults:** 3 rounds/day × 20 = 60 PEP/day ≈ 1,800/month, about 0.5% of current supply per month. Small next to `/work`.

## 10. Moderation and adding questions

- **Add or edit questions:** a PR to `data/trivia/questions.json`. CI (§11) enforces schema, unique ids, https sources, MC answer in choices, no `validUntil` in the past, and that aliases match / rejects fail.
  - New community questions arrive as `status: flagged` until a reviewer checks the sources and flips them to `approved`.
  - Suggested review: Snax or anyone with `ADMIN_ROLE_IDS`.
- **Community suggestions** (phase 3): `/trivia suggest` modal and a web form → `TriviaReport` with `kind=suggestion`. `/admin/trivia` turns a suggestion into a JSON snippet to paste into a PR.
- **Instant pull:** `/admin/trivia` "Disable" (writes `trivia.disabledQuestionIds`), or `/trivia skip` (admin): cancels the open round with no payout and posts "Round cancelled".
- **Disputes:** an admin pays a missed correct answer by hand with the existing `/add-money` (logged), then fixes aliases in a PR.
- **Retirement:** `validUntil` plus a CI warning 60 days ahead. Before each GPP season (April), re-check every `pizzadao` and dated question.
- **Content rules** (in the JSON header and `/admin/trivia` help):
  - One fact per question, with a source.
  - No current prices or counts without a year.
  - Never state a meme as fact; label it `just-for-fun`.
  - No personal details beyond what the person made public.

## 11. Verification

**Unit (vitest, `npm run test:run`):**
- `match.test.ts`: table-driven from the bank (§5).
- `bank.test.ts`: the schema validator over `data/trivia/questions.json`; servable filters; `publicView` never contains answer fields (deep key scan).
- `rounds.test.ts`:
  - Pick avoids repeats.
  - Windows are deterministic per date.
  - Expire posts the reveal once.
  - Attempt caps (T/F one try; a second message from the same user is ignored).
  - `requireMember` / account-age / daily cap.
- `trivia.concurrency.test.ts` (pattern of `pep-economy.concurrency.test.ts`, real DB in CI): 20 parallel correct `claimWin`s → exactly one WON, exactly one `TRIVIA_REWARD` row, wallet +20. A replayed `messageId` → no second row.
- Interactions tests in `app/lib/discord-interactions/__tests__/trivia-command.test.ts`.
- Recorder: `recorder/src/trivia-forward.test.ts`:
  - Filters channel, bots and length.
  - Preserves order under slow POSTs.
  - Retries keep order.
  - Config off = no forwarding.
  - Does not touch the recording chain.
- `npm run lint`, `npm run build`, `cd recorder && npm test && npm run typecheck`.

**Vercel preview checks** (via `/ship`; previews share the prod DB, so all trivia toggles are OFF there):
1. `https://<preview>/trivia` renders logged out (daily card, practice, leaderboard, empty state). Mobile check (`/mobile-check`).
2. `curl -s https://<preview>/api/trivia/daily | jq` and `/api/trivia/practice`: **no** `answer`/`aliases`/`rejects` keys.
3. POST practice answers: correct and wrong verdicts, sources returned after the attempt; 31st request in a minute → 429.
4. `curl -i https://<preview>/api/cron/trivia` without the secret → 401; `/api/trivia/discord/answer` without `RECORDER_API_KEY` → 401.
5. With the secret on the preview: the cron is a no-op ("discord trivia off on preview") and no Discord post happens.
6. `/admin/trivia` gated to admins (non-admin → 404/redirect).
7. OG image `https://<preview>/trivia/opengraph-image` renders.

**Discord dry run before going live:**
1. Create a private `#trivia-test` channel.
2. Production toggle on with `trivia.channelId = #trivia-test` and `rewardPep = 1`.
3. `/trivia start` (admin) → post appears.
4. Two accounts answer at once → one winner, one ledger row (check `scripts/pep-reconcile.sql` = 0 errors).
5. Typo "Trie" wins a T/F; a second T/F guess is ignored; timeout posts the reveal.
6. Restart the recorder mid-round → no lost or double answers.
7. Then switch to the real channel and reward.

## 12. Phased rollout

| Phase | Ships | Gate |
|---|---|---|
| 0. Decisions (no code) | Snax answers §13. Confirm **MessageContent** is enabled for the bot in the Developer Portal (the recorder uses it when `CAPTURE_VOICE_CHAT` is on; check Railway logs for "chat message arrived with empty content"). Create the channel + slowmode. Snax reviews `needs_snax` / `flagged` questions | Answers in this file |
| 1. Bank + web (no rewards) *(implemented, PR for `oregano-27514`)* | `data/trivia/questions.json`, schema/bank/match + tests, Prisma models + `TRIVIA_REWARD` migration (neonctl branch first), `/trivia` (practice + daily + leaderboard shell), `/admin/trivia` read-only, sitemap/nav | Preview checks 1–7 |
| 2. Discord loop | Cron poster/expiry, recorder forwarder (remote-config off by default), answer API + `claimWin` + payout, `/trivia start|skip|leaderboard`, settings group | Dry run (§11), then live at 1–2 rounds/day for a week |
| 3. Community | Reports and suggestions queue, streak polish, OG share, optional web-daily PEP, `/trivia answer` fallback if needed | Snax OK on web rewards |
| 4. Later | DB-backed question editor with two-person approval; Bitcoin Pizza Day "trivia marathon" (May 22: a round every 30 min, double PEP); Telegram mirror via `plans/telegram-shared-bot.md`; translations | Separate plans |

## 13. Decisions (Snax, 2026-11-18)

Snax approved every recommendation below. The original question stays for context; **Decision** is what is built.

1. **Reward currency and amount.** **Decision: $PEP, 20 per win, at most 3 wins per user per day** (no difficulty multiplier at launch: `trivia.difficultyMultiplier` stays off). "toppings" is NFT art, not a currency.
2. **Channel.** **Decision: a new `#trivia` channel with a 3 s slowmode** (Snax creates it and sets the slowmode; its id goes into `trivia.channelId` in phase 2).
3. **Frequency.** **Decision: 3 rounds a day in the US / EU / Asia windows (`trivia.windowsUtc`), 10-minute rounds.**
4. **Web rewards.** **Decision: no web PEP at launch** (`trivia.webDailyRewardPep` = 0; streaks and the leaderboard only).
5. **Sybil / eligibility.** **Decision: only onboarded members win $PEP (`trivia.requireMember` = true), and the Discord account must be at least 7 days old (`trivia.minAccountAgeDays` = 7).** Bounded at 60 PEP/day per real member (3 wins x 20).
6. **Unanswered reveal.** **Decision: reveal the answer when nobody wins** (the "Time's up" post with explanation and source).
7. **Just-for-fun questions.** **Decision: `fun-002`'s wording is approved** ("Just for fun: a fake 'Satoshi email' went viral in 2024. What did it claim was Satoshi's favorite slice?"). **Plain "pineapple" does NOT count** (it is in `rejects`; "pineapple jalapeno" is required). **Fun questions are web/practice only, never in paid Discord rounds** (`pool: "web"`, enforced by the schema). `fun-002` is `approved` in the bank.
8. **Flagged facts.** **Decision: `pz-008`, `eb-035`, `eb-036`, `eb-037` stay excluded until they are verified.** They remain `flagged` in the bank and are not servable (`bank.test.ts` checks it). Verifying one means a PR that flips it to `approved` and assigns a pool.
9. **Naming people.** **Decision: `pz-005` and `jc-002` are OK** (they stay approved).
10. **Bot persona.** **Decision: post as the existing PizzaDAO bot** (no new webhook name or avatar).

Rejected (`bt-000`) and flagged entries are left as they are in the bank. They must never be servable; `bank.test.ts` fails if one is.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Trivia code in the recorder destabilizes call recording | Separate handler + queue, try/catch, fire-and-forget like `dm-forward`; remote-config off by default; recorder tests prove the recording `serial()` chain is untouched |
| MessageContent not granted (privileged intent) | Phase 0 check; fallback `/trivia answer` slash command (same backend) |
| Answers leak via the web API → Discord farming | `publicView`, the web only uses Discord-retired questions, deep-key test, preview curl check |
| Double payout on retries or races | Single-winner conditional UPDATE + `messageId` unique + concurrency test + `pep-reconcile.sql` |
| Previews post or pay (shared prod DB) | Toggles are OFF on non-production by design (`toggles.ts`); cron checks `VERCEL_ENV` too |
| Wrong "fact" in the bank embarrasses PizzaDAO | Sources on every question, disagreements table, flagged statuses, report button, instant disable |
| Matcher too lenient (pays wrong answers) or too strict (frustration) | `rejects`, no fuzzy on numbers, length-scaled thresholds, bank-driven tests; admins fix aliases fast |
| Spam in the channel | Attempt caps, 2 s per-user limit, slowmode, 80-character ignore, no wrong-answer replies |
| Cron misses a slot (Vercel cron jitter) | Slots are "≤ now and not fired today", so the next 5-minute tick catches up; at most one round open at a time |
| Time-sensitive facts go stale | `validUntil` + CI warning + seasonal re-check |

## 15. Sources used for verification (primary first)

- Laszlo thread: <https://bitcointalk.org/index.php?topic=137.0>
- Pizza tx: <https://mempool.space/tx/a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d>
- Blocks: block explorer API (blocks 0, 170, 74638, 210000, 420000, 630000, 840000)
- Whitepaper: <https://bitcoin.org/bitcoin.pdf>
- Mailing list: <https://satoshi.nakamotoinstitute.org/emails/cryptography/1/> and <https://www.mail-archive.com/cryptography@metzdowd.com/msg10142.html>
- Bitcoin Wiki: <https://en.bitcoin.it/wiki/Genesis_block>, <https://en.bitcoin.it/wiki/Controlled_supply>, <https://en.bitcoin.it/wiki/Value_overflow_incident>, <https://en.bitcoin.it/wiki/Laszlo_Hanyecz>
- Wikipedia: [History of bitcoin](https://en.wikipedia.org/wiki/History_of_bitcoin), [Mt. Gox](https://en.wikipedia.org/wiki/Mt._Gox), [Satoshi Nakamoto](https://en.wikipedia.org/wiki/Satoshi_Nakamoto)
- jercos interview: <https://www.bitcoinwhoswho.com/blog/?p=25>
- Laszlo profiles:
  - Bitcoin Magazine: <https://bitcoinmagazine.com/culture/the-man-behind-bitcoin-pizza-day-is-more-than-a-meme-hes-a-mining-pioneer>
  - Cointelegraph (GPU): <https://cointelegraph.com/news/satoshi-invented-gpu-mining-to-defend-the-network-says-early-dev>
  - CoinDesk (Lightning): <https://www.coindesk.com/bitcoin-pizza-day-2-lightning-payment-just-made-history>
- Shannon 1948: <https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf>
- Fake pineapple-jalapeño email:
  - <https://fortune.com/crypto/2024/02/26/who-created-bitcoin-new-emails-satoshi-nakamoto/>
  - <https://unchainedcrypto.com/satoshis-emails-to-a-bitcoin-co-developer-the-5-most-revealing-quotes/>
- PizzaDAO:
  - CoinDesk 2021: <https://coindesk.com/business/2021/05/21/pizzadao-celebrates-bitcoin-pizza-day-with-1m-slice-giveaway/>
  - Pizza Today 2025: <https://pizzatoday.com/news/20000-to-eat-free-pizza-on-may-22-for-bitcoin-pizza-day/149236/>
  - Newswire 2023: <https://www.newswire.com/news/pizzadao-celebrates-third-annual-global-pizza-party-22042669>
  - Rare Pizzas: <https://cryptoslate.com/nft-project-mints-10000-digital-pizzas-in-throwback-to-bitcoin/>, <https://thespoon.tech/the-creators-behind-rare-pizzas-want-to-use-pizza-art-nfts-to-fund-a-global-real-world-pizza-party/>, <https://harvest.art/barn/1/0x4ae57798aef4af99ed03818f83d2d8aca89952c7>
  - Repo data: `data/gpp-contracts.json`, `content/handbook/getting-started/en.ts`, `toppings/src/app/page.tsx`
