# App settings: change rules without a code change

Status: plan, awaiting review (open questions in section 8). Directive (2026-10-28): "everything that can be
a config rather than hard coded should be." Rules such as level gates, vouch counts, hold rules, toggles and
Discord channels should be changeable by an authorised admin in the app, with no PR or redeploy.

The repo is public. This plan, the code and any PR text must name **keys and code defaults only**. Editorial
values (what to omit from posts, blocked terms, etc.) live only in private DB rows, the same way
`CallPostFilter` works today.

## 1. Goal and non-goals

Goal: a typed, validated, audited settings system backed by the database. It has:

- one admin page, grouped by area, showing each setting's current value next to its code default;
- an editor for mission rows (verifier params such as vouch counts, rewards, titles, active flag);
- a path to move the on/off feature toggles out of Vercel env, where changing one needs a redeploy and
  dashboard access.

Non-goals:

- Moving secrets, infra endpoints or chain/contract config into the DB.
- Making cron schedules editable. Vercel reads `vercel.json` at deploy time. Where a schedule is really a
  policy, the cron can run more often and a setting decides whether it acts (see 2.6).
- A general feature-flag service or per-user targeting.
- Translating admin-only setting labels (see 4.5).

## 2. Audit: hard-coded tunables

Recommendation key:

- **DB**: becomes a setting.
- **DB+env**: DB toggle, but env can still force it off (see 4.6).
- **Mission**: already a DB row; needs an editor.
- **Env**: keep as env (secret, infra or arming).
- **Code**: keep in code, with the reason given.

Line numbers are as of `eb14cf6`.

### 2.1 Calls (recently built, high value)

| Name | File:line | Value | Controls | Rec. | Risk if mis-set |
|---|---|---|---|---|---|
| `CALL_TRANSCRIPT_MIN_LEVEL` | app/lib/calls/transcript-access.ts:9 | 6 | Lowest level that can read full call transcripts | **DB** `calls.transcriptMinLevel`, int 1..9 (9 = nobody by level; DPR role still can) | Too low: transcripts exposed to newer members. Confirm when lowering |
| Call-review gate via `DPR_ONLY_MIN_LEVEL` | app/lib/calls/access.ts:10 | reuses 8 | Who reviews and publishes calls and edits post filters | **Code**: pin to the DPR role id (new `isDreadPizzaRoberts`), not the level setting | If it stays coupled, editing the review level silently changes who can publish calls |
| `CALL_RECAP_POST_ENABLED` | app/lib/calls/recap.ts:26 | env, off | Discord recap after publish | **DB+env** `calls.recapPostEnabled` | On by mistake: public posts (filters still apply) |
| Recap `MAX_BULLETS` / `MAX_ACTIONS` / `BULLET_CHARS` | app/lib/calls/recap.ts:22-24 | 5 / 5 / 220 | Recap length | **DB** `calls.recap.*`, bounded 1..10 / 1..10 / 80..400 | Bounded; Discord's 2000-char limit stays enforced in code |
| Recap channel (`ANNOUNCE_DISCORD_CHANNEL_ID` → `DEFAULT_ANNOUNCE_CHANNEL_ID`) | app/lib/calls/recap.ts:158, app/lib/announce/run.ts:42 | env, else code id | Where recaps go | **DB** `discord.announceChannelId` (snowflake, checked at save) | Wrong channel: a public post in the wrong place |
| `CALL_SUMMARY_MODEL` | app/lib/calls/summarize.ts:11,28 | env, else code model | LLM for summaries | **DB** `calls.summaryModel`, allow-list of model ids | Bad id: summaries fail (already retried) |
| `SUMMARY_SYSTEM_PROMPT` | app/lib/calls/summarize.ts:76 | code text | What summaries emphasise or leave out | **Code** default plus optional **private DB** override `calls.summaryPromptExtra` (appended, max 2000 chars) | Editorial, so the override must stay private |
| `MAX_TRANSCRIPT_CHARS`, `MAX_UPLOAD_BYTES`, `TURN_GAP_MS`, `MAX_ATTEMPTS`, `START_BUDGET_MS`, `HARD_DEADLINE_MS`, `TRACK_TIMEOUT_MS`, `RETRY_AFTER_FAILURE_MS`, `SUMMARY_STUCK_MS` | summarize.ts:14, transcribe.ts:20-31,122-127 | various | Transcription mechanics | **Code**: tied to the provider's 25 MB limit and Vercel `maxDuration` | A bad value times out or bills repeatedly |
| `DEFAULT_TRANSCRIBE_MODEL` | transcribe.ts:18 | whisper-1 | Fallback ASR | **Code** (the response format depends on it) | n/a |
| Ingest caps (`MAX_SPEAKERS`, `MAX_TRANSCRIPT_SEGMENTS`, ...) | app/lib/calls/ingest-schema.ts:14-56 | various | Input validation | **Code**: DoS/input bounds | n/a |
| `SIGNED_URL_TTL_SEC` | app/lib/calls/r2.ts:12 | 900 | Audio link lifetime | **Code**: security | n/a |
| `CallPostFilter` row | prisma/schema.prisma:1535, app/lib/calls/post-filters.ts | private | Agenda and recap omissions | Already DB. **Migrate** into settings in Phase 5 (private, fails by throwing) | Unreadable means skip posting (keep) |

### 2.2 Call agenda

| Name | File:line | Value | Controls | Rec. | Risk |
|---|---|---|---|---|---|
| `CALL_AGENDA_POST_ENABLED` | app/lib/call-agenda/run.ts:28 | env, off | Pre-call agenda posts | **DB+env** `callAgenda.postEnabled` | Public posts |
| `DEFAULT_CALL_VOICE_CHANNEL_ID` / `CALL_VOICE_CHANNEL_ID` | run.ts:23,49 | code id / env | Which voice channel's events get agendas | **DB** `discord.callVoiceChannelId` | Wrong id: no agendas |
| `POST_LEAD_MS` | run.ts:25 | 30 min | How early the agenda posts | **DB** `callAgenda.leadMinutes`, 10..120 (the cron runs every 10 min) | Too short: it can miss the window |
| `RESCHEDULE_WINDOW_MS` | run.ts:127 | 6 h | Reschedule re-post logic | **Code** (dedupe correctness) | Double posts |
| `MAX_BULLETS` / `MAX_TASKS` / `MAX_FOLLOWUPS` / `MAX_LEN` | app/lib/call-agenda/rank.ts:8-11 | 7/5/2/110 | Agenda size | **DB** `callAgenda.*`, bounded | Bounded |

### 2.3 Missions and verification (highest value)

| Name | File:line | Value | Controls | Rec. | Risk |
|---|---|---|---|---|---|
| `HUMAN_RELEASE_MIN_LEVEL` | app/lib/mission-verify/policy.ts:25 | 6 | Levels whose auto-verified passes still wait for a human | **DB** `missions.humanReleaseMinLevel`, 1..9 | Raising it lets bigger rewards auto-pay. Confirm when raising; on DB failure use 1 (everything held) |
| `NEW_ACCOUNT_DAYS` | policy.ts:27 | 30 | Discord account age below which passes are held | **DB** `missions.newAccountDays`, 0..365 | 0 turns off the alt-account guard. Confirm when lowering |
| `HOLD_LABEL` text | policy.ts:56 | "under 30 days", "Level 6+" | Reviewer and member copy | **Derived**: `holdLabel(hold, policy)` built from the settings | Stale copy if not derived |
| `DPR_ONLY_MIN_LEVEL` | app/lib/mission-review-access.ts:21 | 8 | Levels only DPR may approve | **DB** `missions.dprOnlyMinLevel`, **2..8 only** (can be made stricter, never looser than today) | Loosening hands the top payouts to more roles. Out of range |
| Reviewer roles L1-L7 (`ADMIN_ROLE_IDS` + `MISSION_REVIEWER_ROLE_IDS`) | app/ui/constants.ts:71,84 | Leonardo, DPR, Capo, Pepperoni Mafia ids | Who approves L1-L7 | **DB** `missions.reviewerRoleIds` (snowflakes, 1..10, resolved at save); DPR is always added in code | Over-broad means more approvers. Can't be emptied |
| Copy "Only DPR reviews Level 8" / reviewer list | app/lib/discord-interactions/mission-review.ts:97 | hard-coded | Refusal text | **Derived** from the settings | Stale copy |
| `MISSION_VERIFIERS_ENABLED` | policy.ts:20 | env | Auto-approve and pay (otherwise a dry run) | **DB+env** `missions.verifiersEnabled` | Pays PEP. On DB failure: off |
| `MISSION_REVIEW_CARDS_ENABLED` | review-cards.ts:49 | env | Discord review cards | **DB+env** | Noise only |
| `MISSION_REVIEW_CHANNEL_ID`, `MISSIONS_ANNOUNCE_CHANNEL_ID` (else `#work`) | review-cards.ts:5, notify.ts:56 | env / by name | Card and level-up channels | **DB** `discord.missionReviewChannelId`, `discord.missionsAnnounceChannelId` | Wrong channel |
| `PIZZA_CAPO_ROLE_ID` as the SLA ping | app/ui/constants.ts:78, sla.ts:30 | Capo id | Who the daily digest tags | **DB** `missions.slaPingRoleId` | Pings the wrong role |
| `SLA_HOURS` / `DIGEST_MAX_LINES` | app/lib/mission-verify/sla.ts:33,36 | 48 / 15 | When a submission counts as overdue | **DB** `missions.slaHours` 1..336, `missions.slaDigestMaxLines` 1..25 | Bounded |
| `MISSIONS_RUN_PEP_ALERT` | nightly.ts:197 | env 50,000 | Alert threshold for a run's payouts | **DB** `missions.runPepAlert` | Too high hides big runs |
| `BULK_APPROVE_MAX` | bulk-review.ts:21 | 50 | Bulk approve batch | **Code** (request size/time) | n/a |
| `MAX_MISSION_ATTEMPTS` | app/lib/missions.ts:398 | 3 | Rejections before a mission locks | **DB** `missions.maxAttempts`, 1..10 | Bounded |
| `RUN_WINDOW_MS` / `MIN_GAP_MS` | nightly.ts:45-46 | 20 h / 12 h | Nightly run bookkeeping | **Code** (tied to the cron slots) | Double runs |
| `STALE_CLAIM_MS`, timeouts, `net.ts` caps | review-cards.ts:54, net.ts:8-9 | various | Mechanics | **Code** | n/a |
| Vouch counts: L4.2 / L6.2 / L8.1 `vouch_received {min}`, L5.2 `vouch_given {min}` | Mission.verifierParams (seeded by mission-config.ts:142,173,214,241) | 1 / 5 / 10 / 1 | Level requirements | **Mission editor** (Phase 2) | Lowering a min can pass members on the next check (L6+ stays held). Raising never claws back (D17) |
| Other params (`attendance_count.min`, `social_post.minReplies/minLikes`, `referral.min`, `rare_pizza_box.minLevel`, `discord_role.roleIds/roleNames`) | mission-config.ts | various | Requirements | **Mission editor**, validated by each verifier's own `parse` | Same as above |
| `Mission.reward`, `levelTitle`, `title`, `description`, `isActive` | DB rows; seeds in mission-config.ts:52-70 | e.g. L6 6,942 | Payout and copy | **Mission editor**, with reward edited per level (shared) | Affects future payouts only. Bounded, with confirm |
| `roleEnv` overrides (`MISSION_CREW_LEADER_ROLE`) | verifiers.ts:96, nightly.ts:91 | env | Role mission override | **Mission editor** (roleIds/roleNames in params); retire `roleEnv` | n/a |
| Celebration `level >= 2` | app/api/missions/celebration/route.ts:121 | 2 | First level that gets a celebration | **DB** `missions.celebrationMinLevel` (low value) | Cosmetic |
| `LevelUpModal` `level >= 8` | app/ui/missions/LevelUpModal.tsx:26 | fallback | Final-level copy | **Code**: already derived from the data; drop the fallback | n/a |
| `PIZZA_NOOB_GRADUATE_LEVEL` | app/lib/trainee-nick.ts:16 | 2 | When the newcomer role is removed | **DB** `onboarding.noobGraduateLevel` | Role churn |
| `TRAINEE_NICK_ENABLED`, `WELCOME_MAX_PER_RUN`, `TRAINEE_WELCOME_TEXT` | trainee-nick-run.ts:502,41,44 | env / 20 / text | Nick cron and welcome DM | **DB+env** toggle, **DB** count and text (max 500 chars) | Spam if raised; bounded |

The mission-progress caches also matter here. `MISSIONS_LIST_CACHE_TTL` (10 min, app/lib/mission-cache.ts:76)
is per instance. The editor must clear the cache locally and lower its TTL to 60 s, so edits reach every
instance quickly.

### 2.4 Disavow list

| Name | File:line | Value | Controls | Rec. | Risk |
|---|---|---|---|---|---|
| `DISAVOW_ENABLED` | app/lib/disavow/constants.ts:37 | env | Whole feature | **DB+env** | Exposure of a sensitive feature. On DB failure: off |
| `DISAVOW_MIN_LEVEL` | constants.ts:7 | 5 | View and nominate | **DB** `disavow.minLevel` 1..9 | Too low exposes nominations more widely. Confirm |
| `DISAVOW_YES_THRESHOLD` | :10 | 3 | DPR yes votes needed | **DB** 2..20 | 1 lets one person list someone. Min 2 |
| `DISAVOW_DECISION_DAYS` / `WINDOW_DAYS` | :16,18 | 7 / 14 | Round timing | **DB**, decision 1..30, window ≥ decision and ≤ 60 (checked against each other) | Open rounds: `closesAt` is already fixed per round. Threshold and decision days apply to open rounds too unless snapshotted onto the round (proposed in Phase 3) |
| `NOMINATIONS_PER_WINDOW` / `NOMINATION_WINDOW_DAYS` | :20-21 | 3 / 30 | Anti-spam | **DB**, bounded | Bounded |
| `LISTING_MONTHS` / `APPEAL_COOLDOWN_DAYS` | :23,25 | 12 / 90 | Listing life, appeals | **DB**, bounded | Bounded |
| `MAX_STATEMENT` ... `PAGE_SIZE`, `REDACTED`, `LOCKOUT_STATUSES` | :27-34, access.ts:21 | various | Input bounds, the no-leak invariant | **Code** | Security/no-leak |
| Disavow DPR gate | access.ts:24 | via `DPR_ONLY_MIN_LEVEL` | Who votes | **Code**: pin to the DPR role (like calls) | Same coupling bug as calls |

### 2.5 Economy, games, shop (mostly env today)

| Name | File:line | Value | Rec. | Risk |
|---|---|---|---|---|
| `PEP_GAMES_ENABLED`, `PEP_CRIME_ENABLED` | app/lib/pep-games/config.ts:21; crime | env | **DB+env** | PEP sinks/sources |
| `GAME_MIN_BET`/`MAX_BET`/`COOLDOWN`/`BLACKJACK_TIMEOUT` | pep-games/config.ts:25-30 | 10/5000/3s/300s | **DB** `games.*`, bounded (max bet ≤ 1,000,000; checked against min) | Inflation/drain |
| `CRIME_*` (min/max/fail%/fine%/cooldown) | app/lib/pep-earn/crime.ts:18-26 | env defaults | **DB** `crime.*`, bounded | Inflation |
| `WORK_MIN_PEP`/`WORK_MAX_PEP`/`WORK_COOLDOWN`, `WORK_PROMPTS_JSON` | pep-earn/work.ts:29-44 | env | **DB** `work.*`; prompts as a string list | Inflation |
| `ROLE_INCOME_JSON` / `DEFAULT_ROLE_INCOME` | pep-earn/income.ts:32,61 | code table / env JSON | **DB** `economy.roleIncome` (list of {roleId or name, amount ≤ 10,000, intervalHours ≥ 1}) | Daily PEP minting. Confirm |
| `JOB_REWARD_AMOUNT`, `DAILY_JOBS_COUNT` | app/lib/jobs.ts:6,8 | 50 / 3 | **DB** | Inflation |
| `DEFAULT_GRANT_MAX` | app/lib/pep-admin.ts:78 | 10,000 | **DB** `economy.adminGrantMax` 1..1,000,000 | Admin mint cap |
| `PEP_ADMIN_ROLE_IDS`/`NAMES` | pep-admin.ts:38 | env | **Code/env** (authority root; see 3) | Mint authority |
| `ITEM_GRANT_CLAIMS`, `SHOP_SHEET_SYNC_ENABLED` | shop-grants.ts:257, shop.ts:185 | env | **DB+env** | Low |
| `PEP_MIGRATION_CLAIMS` | unbelievaboat/claims.ts:175 | env | **Env**: one-time migration arming | Double credit |
| Slot weights/payouts | pep-games/slots.ts:23-26 | table | **Code** (house edge is math that needs tests) | Drain |
| `MAFIA_POINT_SOURCES` / `MAFIA_RANKS` | app/lib/mafia-points/config.ts:43,214 | tables | **DB** later (Phase 5), as lists with bounds | Cosmetic rank |

### 2.6 Slices, POAPs, email, misc

| Name | File:line | Value | Rec. | Risk |
|---|---|---|---|---|
| `SLICES_ENABLED`, `SLICES_ALLOW_NON_PROD`, `SLICES_CHAIN_ID`, `SLICES_CONTRACT_ADDRESS`, minter key, `BASE_RPC_URL` | app/lib/slices/config.ts | env | **Env** (on-chain, hot key, gas). Previews share the prod DB, so a DB toggle would also arm previews | Real ETH spend |
| `SLICES_DAILY_CAP`, `MAX_GAS_GWEI`, `MIN_BALANCE_ETH` | slices/config.ts:45-50 | 1000 / 0.5 / 0.003 | **DB** for lowering only: effective = min(env or code ceiling, DB) | Gas spend |
| `SLICES_BATCH_SIZE`/`MAX_ATTEMPTS`, mint-queue lease/budget | slices/config.ts:16-17, mint-queue.ts:17-22 | | **Code** (nonce/lease correctness) | Stuck nonces |
| `REENGAGE_EMAIL_ENABLED` | app/lib/reengage/run.ts:33 | env | **DB+env** | Emails sent to members |
| `DEFAULT_BATCH`, `CALL_WINDOW_MS` | reengage/run.ts:28, digest.ts:16 | 60 / 7 d | **DB** batch 1..300 (`MAX_BATCH` stays a code ceiling); window 1..30 d | Send rate |
| Reengage cron `0 16-21 * * 2` | vercel.json | weekly | **Code** (vercel.json). Optional: a `reengage.sendWeekday` setting checked by a daily cron (Phase 5) | n/a |
| `DEFAULT_FROM`, `REENGAGE_POSTAL_ADDRESS` | reengage/mailer.ts:26 | | **Env/code** (sender domain reputation, CAN-SPAM) | Deliverability |
| `MAFIA_PORTRAIT_ENABLED`, `*_DAILY_CAP`, `MAFIA_PORTRAIT_MODEL` | app/api/mafia-portrait/route.ts:68-72 | env | **DB+env** toggle; caps DB, lowering only below an env/code ceiling | OpenAI spend |
| `MAX_TICKETS_PER_DAY`/`MAX_OPEN_TICKETS` | support-tickets.ts:19-20 | 5/10 | **DB**, bounded | Spam |
| Spotlight `MAX_SUBMISSIONS_PER_DAY`/`MAX_PENDING` | spotlight.ts:22-23 | 3/5 | **DB**, bounded | Spam |
| `MIN_CALLS_FOR_SUGGESTION`/`INACTIVE_MONTHS` | roster-audit.ts:18-19 | 3/6 | **DB** | Advisory only |
| `ACTIVITY_THRESHOLDS` | projects/types.ts:267 | | **DB** (low) | Cosmetic |
| `RATE_LIMITS` | app/lib/rate-limit.ts:31 | table | **Code** (abuse protection, keyed in Redis) | Abuse |
| Announce roles (`ANNOUNCE_ROLE_IDS`, `LEGACY_ANNOUNCE_DISCORD_IDS`) | announce/access.ts:18,34 | env/code | **DB** `announce.roleIds` (resolved at save, can't be emptied) | Who can mass-announce. Confirm |
| `ARTICLE_AUTHOR_ROLE_IDS` | app/ui/constants.ts:91 | ids | **DB** `articles.authorRoleIds` | Who publishes on the site |
| `REGION_ROLE_IDS`, `TURTLE_ROLE_IDS`, `CREWS` | region-mapping.ts:10, ui/constants.ts:55 | ids | **Code** (onboarding role mapping, rarely changes, structural) | Wrong roles assigned |
| Session/OAuth/magic-login TTLs, Telegram skew, `MAX_SKEW_SECONDS` | session.ts:9, oauth-proxy.ts, magic-login.ts:10-12, telegram-auth.ts:20 | | **Code**: security invariants | Account takeover window |
| Sheet ids, POAP contract, Alchemy chains, subgraphs | sheets/config.ts, poap.ts:10, nft-config.ts | | **Code/env** (protocol/infra) | Breakage |
| Cache TTLs (discord, crew sheet, members) | various | | **Code** (performance, not policy) | n/a |
| Cron schedules | vercel.json | | **Code** (deploy-time by design) | n/a |

## 3. What must NOT become DB config (and the guards on what does)

Keep in env:

- secrets (bot token, API keys, `SESSION_SECRET`, `CRON_SECRET`, minter key, RSA keys, `DATABASE_URL`);
- infra endpoints and ids (`DISCORD_GUILD_ID`, RPC URLs, contract address, sheet web-app URL);
- arming switches that spend real money or run one-time migrations (`SLICES_ENABLED`, `SLICES_ALLOW_NON_PROD`,
  `PEP_MIGRATION_CLAIMS`). A DB toggle reaches previews too, because previews share the prod DB.

Keep in code:

- **Roots of trust.** The DPR role id and `ADMIN_ROLE_IDS` stay pinned in code. They gate the settings
  editor itself, so a bad edit can never lock everyone out or hand the editor to someone else.
- **Security invariants.** Session/OAuth/token TTLs, signature skew, signed-URL TTLs, the disavow
  no-leak/redaction rules and lockout statuses, input length caps, rate limits.
- **Protocol constants.** The Discord epoch and API limits, snowflake regexes, X URL length, chain ids, POAP
  contract, ERC/nonce mechanics.
- **Mechanics tied to the platform.** Timeouts and budgets tied to Vercel `maxDuration`, lease and lock keys,
  batch sizes, retry counts.
- **Game math.** Slot weights and payouts need tests to show the house edge.

Guards on what does move:

1. **Bounds on everything.** Each setting has a zod schema with min/max; the API rejects out-of-range values
   with 400. Settings that depend on each other (window ≥ decision days, max bet ≥ min bet) are checked
   together at save time.
2. **One-directional bounds for money and approval authority.** `missions.dprOnlyMinLevel` may only be
   ≤ 8, so it can be made stricter but never looser than today. Spend caps (slices, portraits) take
   min(code/env ceiling, DB value). Loosening them needs a code change.
3. **Content-access thresholds** (transcript level, disavow level) get the full range, but the UI asks for
   confirmation whenever a change exposes content to more people.
4. **Role and channel ids** must be snowflakes. On save, the bot resolves them in the guild and the save is
   rejected if one doesn't exist. Role lists can't be emptied, and DPR is always included in code.
5. **Fail-safe value per setting** (4.4): toggles that post, pay or email go off; money-hold thresholds go
   to their strictest value; everything else keeps its last-known-good value, then its code default.
6. **The editor gate never reads settings.** It is pinned to the DPR role id.

## 4. Design

### 4.1 Storage: one key/value table (recommended)

```prisma
model AppSetting {
  key       String   @id            // "missions.humanReleaseMinLevel"
  value     Json                    // validated by the code registry on read AND write
  updatedAt DateTime @updatedAt
  updatedBy String                  // discordId
}

model AppSettingChange {
  id        Int      @id @default(autoincrement())
  key       String
  oldValue  Json?                   // null = was default
  newValue  Json?                   // null = reset to default
  changedBy String
  changedAt DateTime @default(now())
  note      String?                 // optional reason typed in the UI
  @@index([key, changedAt])
}
```

- A row exists only for overridden settings. With no row, the code default applies, and "reset to default"
  deletes the row. So deploying the framework changes no behaviour.
- **Why one table, not typed single-row tables per area** (the `CallPostFilter` shape):
  - With one table, adding a knob is a registry entry only, with no migration. Per-area tables would need a
    migration and hand-applied prod SQL for every new knob, which is the friction this work removes.
  - One table gives one generic audit log and one generic admin UI.
  - Type safety is lost at the DB layer but recovered by validating in the registry on both read and write.
  - Per-area tables only win when values need relational integrity or indexing, and none of these do.
    Missions keep their own table and editor (4.7).
- Private values (editorial) are rows like any other. The registry marks them `private: true` (4.5).

### 4.2 Registry in code

`app/lib/settings/registry.ts`, one entry per setting:

```ts
defineSetting({
  key: 'missions.humanReleaseMinLevel',
  area: 'missions',
  label: 'Human release from level',
  help: 'Auto-verified passes at or above this level wait for a reviewer.',
  schema: z.number().int().min(1).max(9),
  default: 6,
  onReadFailure: { value: 1 },         // or 'lastKnownGood' (default behaviour) | 'throw'
  confirm: (from, to) => to > from ? 'Larger rewards will pay out without a human.' : null,
  private: false,
})
```

- Area files (`settings/areas/missions.ts`, `calls.ts`, ...) keep the registry readable. Each area can add a
  `validateArea(values)` cross-field check.
- For toggles migrated from env, `default` is a function of env (`() => envBool('CALL_AGENDA_POST_ENABLED')`),
  so production keeps today's behaviour until someone saves a value (4.6).
- Unit test: every default passes its own schema, keys are unique and match `^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$`,
  and no key contains `secret|token|key|password`.

### 4.3 Read path

`app/lib/settings/index.ts`:

- `loadSettings()` reads all rows in one query (the table is tiny) into a module-level cache with a 30 s TTL,
  the same as post filters. It returns a typed `Settings` snapshot, `get<K>(key)`.
- `getSetting(key)` is the async shorthand.
- The write path clears the local cache. Other instances catch up within 30 s, and the UI says "applies
  within a minute".
- Not `unstable_cache` or the Next data cache: no revalidation tags across regions to reason about.
- **Invalid stored value** (e.g. a bound tightened after the row was written): that key is treated as a read
  failure. It is logged once per instance and flagged red in the admin UI.
- **DB unreachable**:

  | Setting type | `onReadFailure` |
  |---|---|
  | Toggles that post, pay, email or expose a feature (`*.enabled`, `verifiersEnabled`, `recapPostEnabled`, `disavow.enabled`, `reengage.enabled`, games/crime) | **closed**: `false` |
  | Money-hold thresholds (`humanReleaseMinLevel` → 1, `newAccountDays` → 365, `dprOnlyMinLevel` → 1) | **strictest value**: everything waits for a human |
  | Post filters | **throw**: callers skip posting (today's behaviour) |
  | Everything else (access levels, counts, copy, channel ids) | last-known-good in this instance if any, else the code default (the reviewed value) |

  Access levels don't need to fail closed separately: the level lookup (`getCurrentLevel`) needs the same DB,
  and already fails closed.

- **Sync call sites.** Today `releaseHoldFor`, `isNewAccount`, `HOLD_LABEL` and `missionReviewerRoleIds` read
  constants synchronously. They become pure functions that take a policy object (`HoldPolicy`,
  `ReviewPolicy`), with today's values exported as `DEFAULT_*` for tests. Entry points load the snapshot once
  and pass it in (routes, crons, `checkMany` context, interaction handler). This avoids a DB read per item in
  bulk runs.

### 4.4 Decoupling the DPR checks first

`calls/access.ts` and `disavow/access.ts` decide "is this person DPR?" by calling
`canReviewMission(id, DPR_ONLY_MIN_LEVEL)`. Once that level becomes a setting, editing it would quietly change
who can publish calls, edit post filters and vote on disavows.

The fix is a new `isDreadPizzaRoberts(who)` in `mission-review-access.ts`, which checks the pinned role id and
fails closed. The calls, disavow and settings gates use it. Mission review keeps using the level setting.

### 4.5 Admin UI and API

- **Page** `/admin/settings`, DPR only (`requireDpr()` from 4.4), server component plus a client editor. It
  links to `/admin/calls` filters and `/admin/missions`.
- **Layout.** Settings are grouped by area (Missions, Calls, Call agenda, Disavow, Discord, Economy, Email,
  Onboarding). Each row shows:
  - label and help text;
  - the input (number with min/max, toggle, select, string list, role/channel id with the resolved name);
  - the **code default** next to the current value, with a "modified" badge;
  - last changed by (display name) and when;
  - a "reset to default" button.
- Private settings sit in their own "Private" group and are never sent outside this page and its API.
- **Saving.** Each save shows a confirmation dialog when the registry's `confirm` returns text, and accepts an
  optional note.
- **History.** A drawer per setting shows the last 50 `AppSettingChange` rows, plus a page-wide recent-changes
  list.
- **Banner on previews** (`VERCEL_ENV !== 'production'`): "Previews share the production database: edits here
  apply to production." See Q6.
- **API** `app/api/admin/settings/route.ts`:
  - `GET` returns the registry metadata plus current values. It sends `private, no-store`.
  - `PUT {key, value, note?, expectedUpdatedAt?}` validates with the schema, then the area check, then
    resolves ids. It returns 409 if `expectedUpdatedAt` is stale. It writes the row and the audit row in one
    transaction, then clears the cache.
  - `DELETE {key}` resets the setting and writes an audit row.
  - Unknown keys get 400.
- **Copy.** The page chrome goes in `messages/{en,es,fr}.json` under `adminSettings`, following the repo's
  next-intl rule. Setting labels and help stay English in the registry: the page is admin-only and the labels
  change with the code.
- **Member-facing copy that contains a value** ("Level {level}+", "under {days} days") is always built from
  the settings, never written as a literal. Today's literals are in `HOLD_LABEL`, `mission-review.ts:97` and
  any similar messages entries. `transcriptRestricted` already takes `{level}`.

### 4.6 Env toggles into the DB

Snax can't easily edit Vercel env, and every change needs a redeploy, so the toggles move.

The effective value is: env explicitly set to off (`0|false|off`) gives **off** (a hard kill switch for
whoever runs infra). Otherwise the DB value is used if a row exists, else the env value as before (the legacy
default).

- Deploying changes nothing. The first save in the UI takes over from env. Once every toggle has a row, the
  env vars can be deleted (a cleanup step with a checklist in the PR).
- **Not moved:** `SLICES_ENABLED`, `SLICES_ALLOW_NON_PROD`, `PEP_MIGRATION_CLAIMS`, `PEP_ADMIN_ROLE_*`.
  Slices could get a DB "pause" that only turns minting off (effective = env armed AND DB not paused).
- `MISSION_VERIFIERS_ENABLED` moves (it is Snax's main lever). The nightly run already closes a run when the
  flag changes mid-run (nightly.ts:134), so a DB flip mid-run is handled.

### 4.7 Mission editor

There is no mission editing UI today. Rows are changed only by `scripts/missions/set-verifiers.mjs` from
`mission-config.ts`.

- **Page** `/admin/missions` (DPR only). It lists missions by level. Per mission you can edit `title`,
  `description`, `isActive` and `verifierParams`. Per level you can edit `levelTitle` and `reward`, which is
  written to every row of the level so the "shared reward" invariant `settleLevels` relies on holds.
- **Params form.** For known verifier keys (`vouch_received`/`vouch_given` min and sources,
  `attendance_count.min`, `social_post` minReplies/minLikes, `referral.min`, `rare_pizza_box.minLevel`,
  `discord_role` roleIds/roleNames) the form is generated, with a raw JSON fallback for the rest. Every save
  runs the verifier's own `parse()`, so whatever the engine would reject is rejected at save, plus extra
  bounds (min 1..100; reward 1..1,000,000).
- **What is not editable:**
  - `verifierKey` and `proofKind` (changing a mission's verifier is a code change);
  - creating or deleting missions (still the script);
  - `level` and `index`.
- **Audit.** Changes go to `AppSettingChange` with key `mission:<id>:<field>`, so there is one history.
- **Caches.** Saving clears the mission list and progress caches in this instance, and the list TTL drops to
  60 s.
- **Confirm messages.**
  - Lowering a `min`: "Members who already meet the new count pass on their next check; L{n} passes still wait
    for a human if n ≥ {humanReleaseMinLevel}."
  - Changing a reward: "Applies to levels completed from now on; already-paid levels are not topped up or
    clawed back."
- **`set-verifiers.mjs` must stop overwriting edits.** Today it rewrites `verifierParams` whenever they differ
  from code (mission-config.ts:394), so a rerun would undo admin edits. It also aborts on reward mismatch. The
  change:
  - by default it only INSERTs missing missions and fills NULL params;
  - `--force-params` restores the code values;
  - an inserted mission takes the level's **current DB** reward;
  - the header comment says the DB is the source of truth once the editor ships.
- **`roleEnv` (`MISSION_CREW_LEADER_ROLE`)** stays readable for back-compat. The editor writes `roleIds` or
  `roleNames` instead.

### 4.8 Tests (vitest)

- `settings/registry.test.ts`: defaults are valid, bounds hold, cross-field checks work, key format, no
  secret-like keys, and every `DEFAULT_*` equals the constant it replaced (a no-change-on-deploy lock).
- `settings/index.test.ts`, with mocked prisma (add `appSetting` and `appSettingChange` to
  `app/lib/__mocks__/db.ts`):
  - cache TTL and clearing;
  - a missing row returns the default;
  - an invalid row falls back and logs;
  - a DB throw gives the right `onReadFailure` per kind: closed, strictest, last-known-good, throw;
  - env toggle precedence covers env off, row present and the legacy default.
- `api/admin/settings/route.test.ts`:
  - 401 without a session, 403 for a non-DPR user;
  - 400 for an out-of-range value, an unknown key or an unresolvable snowflake;
  - 409 when `expectedUpdatedAt` is stale;
  - the setting row and audit row are written in one transaction;
  - a private value never appears in non-DPR responses.
- Policy tests: update `policy`, `engine`, `bulk`, `nightly`, `review-cards`, `transcript-access`,
  `disavow/*` tests to pass a policy, and add cases at non-default values (e.g. human release at 5 holds an L5
  pass; transcript level 4 lets an L4 member read).
- Mission editor:
  - a `parse()` rejection gives 400;
  - a level reward is written to all rows;
  - caches are cleared;
  - a `set-verifiers` plan with edited params gives no change by default, and a reset with `--force-params`.
- `isDreadPizzaRoberts` tests, and a test that the call-review gate ignores `missions.dprOnlyMinLevel`.

## 5. Phases (small PRs, ordered by value)

Each migration is applied to prod by hand before merge (`prisma migrate deploy` against Neon with the prod
`DATABASE_URL`), as with `20261031000000_call_post_filters`.

1. **Phase 1: framework and gates.**
   - Migration `2026110x_app_settings`: `AppSetting` and `AppSettingChange`.
   - The registry, loader, API, `/admin/settings` and `isDreadPizzaRoberts` decoupling (4.4).
   - First settings: `calls.transcriptMinLevel`, `missions.humanReleaseMinLevel`, `missions.newAccountDays`,
     `missions.dprOnlyMinLevel` (bounded ≤ 8), `disavow.minLevel`, `missions.slaHours`,
     `missions.slaDigestMaxLines`, `missions.maxAttempts`.
   - Copy derived from settings (`holdLabel`, refusal text).
   - With no rows, behaviour is identical (the lock test).
2. **Phase 2: mission editor.**
   - No migration (`Mission` already has the columns).
   - `/admin/missions` covers vouch counts, all verifier params, rewards, titles and active flags.
   - `set-verifiers.mjs` stops overwriting edits; the mission list cache TTL drops to 60 s.
3. **Phase 3: toggles and Discord targets.**
   - DB+env toggles: verifiers, review cards, recap post, agenda post, reengage email, disavow, trainee nick,
     games, crime, portrait, item grants, shop sync.
   - Channel/role settings with save-time resolution: review, announce and voice channels; SLA ping role;
     L1-L7 reviewer roles; announce and article-author roles.
   - Disavow voting rules (threshold, decision/window days, nominations, listing, appeal), with an optional
     migration to snapshot `yesThreshold`/`decisionDays` on each round so open rounds keep their rules.
4. **Phase 4: economy numbers.** Games/crime/work numbers, role income table, job reward and count, admin
   grant cap, `runPepAlert`, slices and portrait spend caps (lowering only). Retire the env reads, with env as
   the legacy default.
5. **Phase 5: content and cleanup.**
   - Recap and agenda sizes and lead time; summary model and private prompt addendum; reengage
     batch/window/weekday; spotlight/support caps; roster-audit and celebration levels; mafia points and
     ranks.
   - Migrate `CallPostFilter` into private settings (data migration, then drop the table in a follow-up PR).
   - Delete the env vars once DB rows exist.

## 6. Risks

- **Previews share the prod DB.** An edit on a preview is a prod edit. Mitigations: the banner, and the prod
  loader ignores unknown keys and values that fail its schema, so a preview's looser schema can't break prod.
- **Lowering mission requirements pays out at the next check.** Mitigations: the confirm text, the L6+ human
  release, and the nightly alert threshold.
- **Raising `humanReleaseMinLevel` doesn't release existing holds.** Rows already HIGH_LEVEL-held stay for a
  human; they are deliberately not auto-released.
- **Up to 30-60 s of propagation between instances.** Acceptable; the UI says so.
- **Settings scattered behind async reads could slow hot paths.** It is one cached query per instance per
  30 s, and bulk runs load once.
- **Public repo leakage.** Private keys default to empty, PR text names keys only, and the admin API is
  `no-store`. Audit rows for private keys are readable only by DPR.
- **Admin lock-out.** Impossible by design, because the editor gate is the pinned DPR role and never reads a
  setting.

## 7. Verification

- `npm run lint`, `npx tsc --noEmit`, `npx vitest run`.
- Before merging Phase 1, run the migration against prod (dry-read first with `prisma migrate status`).
- Vercel preview (`vercel-deploy`), signed in as DPR:
  1. `/admin/settings` lists the Phase 1 settings with defaults equal to current values and no "modified"
     badges.
  2. A non-DPR account gets 403 from the API and no page.
  3. Set `calls.transcriptMinLevel` to 9: an L6 test account loses the transcript within about 1 min, and the
     restricted message shows "9". Reset, and access returns. The history shows both changes with author.
  4. An out-of-range value (0, 10) is rejected inline.
  5. Phase 2: change L4.2 `min` 1 → 2 on a test level row. "Check my progress" for a member with one vouch
     shows 1/2. Reset.
  6. Confirm `/admin/calls` still works and the call-review gate is unchanged.
- After merge: watch the next nightly run and the `mission-sla` digest for unchanged behaviour.

## 8. Open questions

1. **Who may edit settings and missions?** Recommended: DPR only, pinned in code. Approval-authority settings
   are one-directional (stricter only without a PR).
2. **Env toggles.** Recommended: move to DB with env as the legacy default and env "off" as a hard kill. Keep
   slices arming and the one-time migration flags env-only.
3. **Mission editor scope.** Recommended: params, rewards (per level), titles/descriptions and active flag.
   Changing a verifier type or adding/removing missions stays a code/script change. Reward edits apply going
   forward only: no top-ups, no clawbacks.
4. **Behaviour when the settings DB can't be read.** Recommended: hold every auto-verified pass for a human
   and switch posting/paying toggles off. Everything else uses last-known-good, then the default.
5. **Fold `CallPostFilter` into the new system?** Recommended: yes, but last (Phase 5); it works today.
6. **Edits from preview deploys.** Recommended: allow them, with a "this changes production" banner, so
   previews can be checked end to end. The alternative is to block writes outside production.

## Decisions (Snax, 2026-10-28)
1. Editors: Dread Pizza Roberts only (gate pinned in code). Approval-authority and spend settings can only be made stricter from the admin page; loosening needs a PR.
2. Env toggles move to the DB: env stays the fallback when no row exists, env "off" is a kill switch that always wins. Slices arming and one-time migration flags stay env-only.
3. Mission editor scope: verifier params, per-level rewards, titles, active flag. Reward changes apply going forward only (no top-ups, no clawbacks). No creating missions from the UI.
4. Preview deploys may edit settings, with a "this changes production" banner.
5. Defaults taken: settings unreadable → every auto-pass waits for a human and posting/paying/emailing toggles go off; CallPostFilter folds in last (phase 5).

## Phase 3 implementation notes (2026-10-29)
- Previews share the production database, so on any deploy where `VERCEL_ENV` is not `production` the feature switches ignore saved rows and follow the env var only (env off still wins). A saved ON never reaches a preview.
- Disavow yes votes (min 3) and decision days (min 7) are stricter-only from the admin page; loosening needs a PR.
- Rounds snapshot `yesThreshold` and `decisionDays` when they open (migration 20261102100000_disavow_round_rules); null columns mean the code defaults.
- Announcement and article-author role lists always include the top role in code.

## Phase 4 implementation notes (2026-10-29)
- New group "Economy and spend caps" (`economy-settings.ts`) plus `missions.runPepAlert`. No migration.
- Every payout, cap and limit is stricter-only: the schema bound stops at today's value. Saved values act as a ceiling over the legacy value (`numbers.ts`): min(env or default, saved) where higher is looser, max where lower is looser, so an env value that is already stricter still wins. Only `games.minBet` and `games.blackjackTimeoutSeconds` take the full range (no spend risk).
- No saved row: env is the legacy value (`GAME_*`, `CRIME_*`, `WORK_*`, `JOB_REWARD_AMOUNT`, `ADMIN_GRANT_MAX`, `MISSIONS_RUN_PEP_ALERT`, `SLICES_*`, `MAFIA_PORTRAIT_*_DAILY_CAP`, `ROLE_INCOME_JSON`), else the code default. Unreadable settings: the last saved value this instance saw, then the legacy value.
- `economy.roleIncome` is a table input (`roleIncome`). Rows can be removed or made smaller or slower; a row must be a built-in role with the same id. Saving replaces the `ROLE_INCOME_JSON` table.
- Slices gas and balance use whole thousandths (milli-gwei, milli-ETH) because settings are integers; with no row the env decimals are used untouched.
- Left for phase 5: `WORK_PROMPTS_JSON` (string list), slot weights stay in code, `MISSIONS_CRON_*` budgets stay env.
- Review fixes: the role income table is judged against the table actually in force (ROLE_INCOME_JSON if valid, else built-in); the admin page and loosening/reset confirmations use the env-aware baseline; a saved smallest bet is clamped to the largest bet in force; slices thousandths are compared in env units.
