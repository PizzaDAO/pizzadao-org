# Profile first-load speed (`/profile/[id]`)

Goal: a first load of a member profile on pizzadao.org should never take 6+ s. Target: the
profile HTML (hero and summary painted) **under 1.5 s at p95** and **under 3 s on a truly cold
instance**. All above-the-fold client data should land within 1 s of hydration.

Investigated at `origin/main` 3c69abe4 (2026-11-17). Read-only; nothing deployed.

---

## 1. Measured breakdown

How it was measured: `curl -w` and a small chunk-timing script (`fetch` + stream reader, logging
when each chunk arrives) against pizzadao.org. To get repeatable cold instances, it also hit
**older production deployment URLs** (`onboarding-<hash>-pizza-dao.vercel.app`). Those
deployments are idle, so their instances are cold. They run with `VERCEL_ENV=production`
against the prod DB.

### 1a. The page HTML (`GET /profile/[id]`)

| Case | Headers (shell + loading.tsx) | `<title>`/metadata chunk | Profile content chunk | Total |
|---|---|---|---|---|
| Warm instance, any id | 0.25 s | 0.26 s | 0.28 s | **0.28 s** |
| Cold instance, member with Discord activity (2468, old deploy) | 3.0 s | 3.5 s | **8.8 s** | 8.8 s |
| Cold instance on current prod right after a deploy (1220) | 2.1 s | 2.5 s | **11.1 s** | 11.1 s |
| Cold instance, deploy from **before** Discord activity shipped (2 d old) | — | — | — | **3.35 s** |
| Original report (2468 on prod) | 2.0 s | — | — | 6.7 s |

In the browser the spinner from `loading.tsx` shows at headers time. The real page (the
`ProfileClient` payload) only arrives in the last chunk, because `page.tsx` awaits
`Promise.all([getBuddyRecognition, getPublicProfileSummary, loadDisavowWarning])` before it
renders anything.

### 1b. `GET /api/profile-summary/[id]` on a cold instance (one cold deployment per sample)

| Member | Has a `DiscordActivity` row | Cold TTFB |
|---|---|---|
| `/api/session` (trivial route, baseline) | — | 2.0, 2.5, 2.7 s |
| 135, 138 (mafia rank cached, join date stored) | no | 3.0, 3.1 s |
| 2468, 102 | **yes** | **4.9, 8.5, 9.4, 10.6 s** |
| Any id, same instance once warm | — | 0.17–0.32 s |

So, on a cold instance:
- **~2.0–2.7 s**: the function cold start alone (Fluid, iad1, Node 24, 13.76 MB function bundle).
- **~0.5 s**: the cold DB work of the full compose (Prisma/Neon connect plus ~25 queries).
- **~2–8 s**: the public Discord activity block, only for members who have a
  `DiscordActivity` row. That is 4,210 rows with messages, so most active members. This
  shipped on 2026-11-16 (#378/#379). A deployment from before it serves the same cold page in
  3.35 s. **It is a regression.**

### 1c. Client fan-out after hydration (browser)

After the HTML arrives, `ProfileClient` and its children fire these requests on mount, all in
parallel:

| Request | Fired by | Cold TTFB | Warm TTFB |
|---|---|---|---|
| `/api/session` | `useSession` (and the nav) | 2.55 s | 0.10 s |
| `/api/profile-summary/[id]` (immediate refetch, `initialDataUpdatedAt: 0`) | `useProfileSummary` | 2.50 s (≈10 s if that instance is also Discord-cold) | 0.32 s |
| `/api/articles/by-member/[id]` | `ContributionsBlock` | 2.05 s | 0.08 s |
| `/api/vouches?memberId&limit=5` | `VouchesWidget` | 2.25 s | 0.08 s |
| `/api/vouches/vouchers?memberId` | `VouchedBy` | 2.42 s | 0.08 s |
| `/api/passport/[id]` | `PassportBlock` | 2.41 s | 0.13 s |
| `/api/attendance/[id]` | `AttendanceCard` | 1.89 s | 0.09 s |
| `/api/collection-stats/[id]` | `CollectionsLazy` stats line (on mount) | 2.12 s | 0.11 s |
| `/api/poaps/[id]?limit=14`, `/api/nfts/[id]`, `/api/unlock-tickets/[id]`, `/api/me` (then `/api/member-lookup`) | `CollectionsLazy` once within 200 px of the viewport | 1.4–2.1 s | 0.06–0.26 s |

There is no deep waterfall: each call is one hop, and only `UnlockTicketCard` chains
`/api/me` into `/api/member-lookup`. But every call can land on a cold API instance. Cold, the
below-the-hero sections fill in about 2–2.5 s **after** the HTML. That makes a fully cold
browser first load about 11 s for the HTML plus 2.5 s for these sections. Client JS is about
259 KB (brotli) across 16 chunks, which is not the bottleneck.

### 1d. What runs on the request path (cold), and the caps on each

`generateMetadata`, which calls `composeProfileSummary({ light: true })`:
- `fetchMemberById` → `getMembersTable` → `membersFromDb()` → `loadSettings()` (DB, **per-instance memory**, 30 s) → `unstable_cache(loadMembersPayload)` (shared data cache, 120 s; 606 rows, ~0.3 MB of jsonb) → `buildMembersTable` plus the index (per-instance memo).
- `resolvePfpUrlAsync` (fs + `memberPfp.findMany`), `getMemberTagline` (Prisma).
- **Google Sheets: none on this path.** `sheets.source.members`, `crews` and `crewTasks` are all `db` in prod `AppSetting`.

`ProfilePage` → `getPublicProfileSummary(id)`. This has a **per-instance memory cache** (5 min,
500 entries), so every cold instance starts empty. A miss runs the full compose:

| Lookup | Upstream | Cap |
|---|---|---|
| member row | as above (it is not deduped with `generateMetadata`; it re-runs, but hits the memo) | none |
| pfp, tagline, xAccount | Prisma | none |
| `getUserProgressSummary` | 4 Prisma queries (chained after the member read) | none |
| `getVouchCounts` | 6 Prisma counts | none |
| `getCrewMappings()` | KV (`swrGet`, **`serveStale` false**: past 5 min the first caller blocks on a reload of 11 crews, task reads limited to 3 at a time, and the KV gen reads) | none |
| `getMafiaRank` | `MafiaRankCache` row; if missing or stale, the live path (Discord + Alchemy + POAP, KV-cached). 143/601 members have no row | **1.2 s** (`MAFIA_RANK_BUDGET_MS`), then `after()` |
| `resolveMemberSince` | 4 Prisma reads plus a Discord guild-member lookup when no join date is stored (207 members have no extras row) | **0.8 s**, then `after()` |
| **`getPublicDiscordActivity`** | `toggleEnabled` → `discordActivity.findUnique` → **`getPublicChannelNames()`**: Discord `GET /guilds/{id}/roles` + `GET /guilds/{id}/channels`, **no timeout, cached in per-instance memory for 1 h** (5 min after a failure) | **none** ← the bug |

Also in `ProfilePage`:
- `getBuddyRecognition`: up to 5 Prisma reads in sequence, plus the members memo. No cap.
- `loadDisavowWarning`: a settings read. The session is read only when disavow is enabled.

The hover card (`app/api/public/member-card/[id]/route.ts`) already wraps
`getPublicDiscordActivity` in an 800 ms budget. **The profile summary is the one caller that
does not.**

Why "warm is fast, but other ids are fast too": the slow part is per **instance**, not per id.
That is the Discord channel list (1 h memory), settings and the Prisma connection. Once one
profile has paid for it, every other id on that instance is about 0.2–0.3 s.

Why the owner keeps hitting it: production is redeployed about 10 times a day (18 prod deploys
in the last ~2 days). Every deploy starts with cold instances and empty in-memory caches. The
every-minute crons do not keep the page's instance warm: prod measured 2.1 s to headers about
5 min after a deploy went Ready.

---

## 2. Root causes, ranked

1. **The Discord channel-name lookup is uncapped and blocks the whole page** (adds 2–8 s on
   every cold instance, and once an hour per warm instance, for members with Discord activity).
   `composeProfileSummary` awaits `activityPromise` with no deadline. `getPublicChannelNames`
   uses bare `fetch` with no `AbortSignal.timeout`, and its cache is per instance. Discord
   answers these two guild-wide calls slowly from Vercel. The bot token is shared with the
   recorder and crons, so rate limits may play a part. The exact Discord latency was not
   measured, because doing so needs the bot token; step 1 adds the timing log that confirms it.
2. **The function cold start is about 2–2.7 s, and frequent deploys make it common.** It hits the
   page and every client API call separately.
3. **The page renders nothing until the full summary, buddy recognition and disavow have all
   resolved.** The light hero data that `generateMetadata` already computes is not used to paint
   early. Slow sections are not streamed.
4. **The in-memory-only summary cache.** Each cold instance recomposes from scratch: about 25 DB
   queries plus Discord, mafia and Discord-join side paths. That is fine warm, but it is what
   makes the cold path expensive.
5. **The client fan-out of 8–12 API calls after hydration.** Each can be a separate cold start,
   and they include an immediate refetch of the heavy `/api/profile-summary`, which can repeat
   root cause 1 on an API instance.
6. Smaller ones: `getCrewMappings()` blocks on a full reload every 5 min (`serveStale` false).
   The members table is rebuilt per instance. `getBuddyRecognition` runs its queries in sequence.

---

## 3. Fixes, ranked by impact and effort

### Fix 1: Cap Discord activity and add Discord timeouts (impact: very high, effort: S) — do first

Files:
- `app/api/profile-summary/[id]/route.ts`
- `app/lib/discord-activity-public.ts`
- `app/lib/discord-activity-public.test.ts`
- `app/api/profile-summary/[id]/route.test.ts`

Steps:
- In `composeProfileSummary`, wrap `activityPromise` with
  `withDeadline(activityPromise, DISCORD_ACTIVITY_BUDGET_MS, null)`.
  - Use 500 ms, exported as a constant like `MAFIA_RANK_BUDGET_MS`.
  - If it timed out, call `keepAlive(activityPromise)` and add the summary to `INCOMPLETE`, so
    it is not memoised and the next load picks the block up. This is the same pattern as mafia
    and member-since.
- In `getPublicChannelNames`:
  - Add `signal: AbortSignal.timeout(1500)` to both Discord fetches.
  - Or better, reuse `getGuildChannels` / `getGuildRoles` from `app/lib/discord-channels.ts`.
    They already have a 2.5 s timeout, a 1 h cache, stale-on-failure and a 60 s negative cache.
    That also shares one cached channel and role list per instance with the mission verifiers.
- Add a single-flight guard: concurrent cold requests share one in-flight promise instead of
  each calling Discord.
- Temporarily log the elapsed time of the Discord pair:
  `console.info("[discord-activity] channel names", { ms, ok })`. That confirms the latency in
  `vercel logs`. Remove it in a follow-up.

Expected: the cold page drops from 8.8–11 s to about 3 s (cold start + 0.5 s), and the warm
hourly spike disappears.

Tests:
- A fake Discord fetch that never resolves: compose returns within the budget with
  `discordActivity: null`, and the summary is not cached.
- A rejected fetch gives `null` names, so no channel names are shown (the existing privacy rule).

### Fix 2: Take Discord off the request path entirely (impact: high, effort: S–M)

- Keep the public channel-name map in a **shared** cache instead of per-instance memory.
  - Use `swrGet` (KV) with `serveStale: true`, fresh for 1 h and kept for 7 d, under the key
    `discord:public-channel-names:v1`, storing a plain `[key, name][]`.
  - A cold instance then reads one KV key (~20–50 ms) and never waits on Discord. A refresh
    runs in `after()` under the existing lock.
  - Optionally have a cron (e.g. extend `/api/cron/feature-links` or `crew-roster`) refresh it
    nightly, so even the first request after a KV eviction is served.
- Privacy: the cached value is exactly what `publicChannelNames()` computes today (only
  @everyone or the configured-role-visible names). On a read failure, keep the current
  behaviour of showing no names. A changed `members.discordActivityPublicRoleIds` setting must
  invalidate the key; include a hash of the role ids in the key.
- Alternative considered: resolve public names at write time in the recorder (Metalhead), when
  it stores `topChannels`. That is cleaner long term, but it goes stale when channel permissions
  change, and it needs a recorder deploy. Rejected for now.

### Fix 3: Paint the hero immediately and stream the slow parts (impact: high, effort: M)

File: `app/profile/[id]/page.tsx`.
- Wrap the light compose in React `cache()`, so `generateMetadata` and the page share one
  member and pfp read per request.
- Give the page an overall budget:
  `withDeadline(getPublicProfileSummary(id), 1200, null)`.
  - On timeout, render with a summary built from the light compose: hero name, pfp, tagline and
    city; about; crew ids filtered against an empty list. Check `withoutNonCrewIds` with no
    mappings: the community-call id must still be dropped. Use `NON_ROSTER_CREW_IDS`
    statically.
  - Then let the client refetch fill in the level, rank, member-since and Discord activity.
  - `keepAlive` the full compose so its in-memory cache fills.
- Put `getBuddyRecognition` behind its own `<Suspense>`, in a small server component passed as
  a slot or child into `ProfileClient`, so it never holds up the hero. Or apply the same
  deadline to it.
- Alternative considered: hand the full-summary promise to the client with React 19 `use()`
  plus `<Suspense>` per section. That is a more granular stream, but it is a bigger refactor of
  `ProfileClient`, which is built around a single `data` object. Keep it for later.

### Fix 4: A persistent, shared cache for the composed public summary (impact: high, effort: M)

File: `app/api/profile-summary/[id]/route.ts`, in `getPublicProfileSummary`.
- Back it with `unstable_cache` (the Next data cache, shared across instances and deploys of
  the same build).
  - Key `["profile-summary-v1", id]`, `revalidate: 300`, tags `["members", `profile:${id}`]`.
  - Keep the in-memory map as an L1 cache in front of it.
- Do not cache incomplete summaries. Inside the cached function, throw a sentinel error that
  carries the value when `INCOMPLETE.has(summary)`. Catch it outside and return the value, so
  nothing is stored. The payload is plain JSON (dates are already ISO strings).
- Invalidate `profile:${id}` (`revalidateTag(..., { expire: 0 })`) where the profile changes:
  profile edit/extras/tagline, PFP compose, vouch add/remove, mission approval, X connect.
  `members` is already expired by `invalidateMembersCache`. Staleness otherwise stays at the
  current 5 min.
- Note that the data cache is per deployment build on Vercel, so the first request after a
  deploy still composes once. It no longer composes once per instance.
- Alternative considered: a KV `swrGet` per id. That works too and survives deploys, but it
  adds KV write volume of about 600 keys. Prefer `unstable_cache` for consistency with
  `getMembersTableFromDb`.

### Fix 5: Prewarm after deploys and keep warm (impact: medium-high on the 2–2.7 s floor, effort: S)

- **Post-deploy warm-up.** Add a GitHub Actions workflow on `deployment_status` with state
  `success` and environment `Production`, or a Vercel deploy webhook. After a 20 s delay it
  curls, 3–4 times in parallel:
  - `/profile/<a few ids>`
  - `/api/profile-summary/<id>`
  - `/api/session`
  - `/api/attendance/<id>`, `/api/passport/<id>`, `/api/collection-stats/<id>`,
    `/api/vouches?memberId=<id>`
  - `/`
  
  Parallel requests make Fluid start more than one instance. This also fills the shared caches
  from Fix 2 and Fix 4. Confirm first that the Vercel GitHub integration emits
  `deployment_status` for this repo. If it does not, have `vercel-deploy` / `/ship` run a warm
  script after `--prod`.
- **Keep warm.** Add `/api/cron/warm` every 5 min (CRON_SECRET). It fetches
  `${SITE_URL}/profile/<id>` and `/api/profile-summary/<id>` over the public URL, so the request
  reaches the page function. Add it to `vercel.json`, and update
  `app/api/cron/cron-routes.test.ts`.
- Pick the warm-up ids from config (an AppSetting, e.g. `perf.warmProfileIds`, with an admin
  field), not hard-coded, per the repo's "config over hard-coding" rule.
- Alternative considered: Vercel's provisioned-concurrency-style features. Not available on
  this plan or setup. Bytecode caching is already on with Fluid.

### Fix 6: Trim the client fan-out (impact: medium, effort: S–M)

- **Drop the immediate `/api/profile-summary` refetch.**
  - `ProfileClient` already derives `viewerId` from `useSession`. Set `initialDataUpdatedAt`
    to `Date.now()` when `initialSummary` came from the server, keeping
    `summaryHasViewer = !!session || dataUpdatedAt > 0`.
  - Refetch only when the summary was the light fallback from Fix 3. Use a flag such as
    `initialSummary.partial = true`.
  - This removes one heavy call per view, and the case where that refetch lands on a
    Discord-cold API instance.
- **Prefill the above-the-fold blocks on the server.**
  - Attendance, passport, articles, vouches and vouchers are each 1–3 cheap DB reads.
  - Use `prefetchRoute` (`app/lib/server-prefetch.ts`), or call their library functions
    directly, inside `page.tsx` with a short combined budget (e.g. 300 ms each, null on
    timeout). Pass the results as `initialData`.
  - Passport stays per viewer: only prefill the anonymous view, and let the client refetch when
    a session exists.
  - That removes 5 cold round-trips from the critical path.
- Leave POAP, NFT and tickets lazy, as they are now (below the fold).

### Fix 7: Small cleanups (impact: low-medium, effort: S)

- `getCrewMappings(false, { staleWhileRevalidate: true })` in `composeProfileSummary` and the
  member card. This stops the blocking reload every 5 min.
- `getBuddyRecognition`: run the two independent branches (as buddy / helped by) with
  `Promise.all`.
- Pre-create `MafiaRankCache` rows for the 143 members without one. Check why the nightly
  precompute skips them, for example members without wallets or Discord. Otherwise each of
  their views costs the full 1.2 s budget until the live path stores a row.

### Long term (not in this task): static or ISR public hero

The root layout reads cookies and headers for the locale, and the page reads the session for
disavow, so the whole route is dynamic. Serving the public hero from the CDN means:
- moving locale resolution to the client or to the URL, and
- moving disavow to a client-fetched or proxy-decided part, then
- `export const revalidate = 300` on the page, or Next 16 `cacheComponents` / PPR with
  `"use cache"` on the public summary.

That would take the cold start off every first load. It is a cross-cutting change; plan it
separately.

---

## 4. Recommended order and target

| PR | Contents | Expected cold first load (HTML) |
|---|---|---|
| PR 1 | Fix 1 (+ Fix 7's crew-mappings SWR) | 8.8–11 s → **~3 s** |
| PR 2 | Fix 2 + Fix 6 (drop refetch, server-prefill) | ~3 s, with the client sections at **+0 s** instead of +2.5 s |
| PR 3 | Fix 3 + Fix 4 | **~2.3 s** worst case (cold start + <0.3 s); hero never waits on side lookups |
| PR 4 | Fix 5 (warmers) | p95 **< 1.5 s**: real users rarely meet a cold instance; warm path is 0.25–0.35 s |

Target, as page TTFB-to-last-byte from iad1 measured with curl:
- **p95 < 1.5 s, p50 < 0.5 s**
- worst-case truly cold instance < 3 s
- no profile section waiting more than 1.2 s on any external API

---

## 5. Risks

- **Fewer badges on cold loads.** With the budgets, a cold load may show no Discord-activity
  block, rank or member-since on first paint. They appear on the client refetch, or on the next
  load. This is the same trade-off already accepted for mafia and member-since. Keep the
  `INCOMPLETE` rule so incomplete summaries are never cached.
- **Discord activity privacy.** The shared channel-name cache must contain only the
  already-filtered public names, never raw channels or permissions. On failure it must show no
  names. Key it by a role-id hash so a settings change cannot serve an old allow-list.
- **Stale summaries from `unstable_cache`.** A missed invalidation point means up to 5 min of
  stale data, the same as today's per-instance cache. Data-cache items over 2 MB are not stored
  (one summary is a few KB, so this is fine).
- **Warmer cost.** About 300 extra invocations a day from the cron, plus a burst per deploy. This
  is negligible on Fluid. The cron must never write anything.
- **Dropping the refetch.** Owner-only UI depends on the session query. Verify that the owner
  dock and banner still appear for the owner, and that `?as=visitor` still hides them.
- **The light fallback summary.** The crew row must not show the Community Call pseudo-crew
  when no mappings are loaded.

---

## 6. How to verify

Before and after, use the same method as section 1.

1. **Unit tests**:
   - `npx vitest run app/api/profile-summary app/lib/discord-activity-public.test.ts app/lib/discord-channels.test.ts app/api/public/member-card app/api/cron`
   - New tests: compose with a hanging Discord fetch returns within budget and is not memoised;
     the shared channel-name cache serves stale names and refreshes in the background; the
     page fallback summary drops the non-crew ids; `ProfileClient` does not refetch when given
     a full `initialSummary`.
2. **`npm run lint`, `npx tsc --noEmit`, `npm run build`.**
3. **Vercel preview.** Previews are cold by construction and read `sheet` sources unless
   env-flipped, so compare against prod only for the Discord part:
   - Fresh preview URL: `node chunks.mjs https://<preview>/profile/2468`. The content chunk
     should arrive within about 1 s of the headers, not 5+ s.
   - Repeat for 102 and 1220 (with activity) and 135 (without).
4. **Production, after each merge**:
   - Within 1–2 min of the deploy going Ready, run
     `curl -w '%{time_starttransfer} %{time_total}\n' https://pizzadao.org/profile/<id>` for 5
     never-viewed ids. Pick them with `pizzadao-db` from members that have a `DiscordActivity`
     row. All should be under 3 s (PR 1) or under 1.5 s (after PR 4 warmers).
   - Run `/api/profile-summary/<id>` cold the same way.
   - Check the `[discord-activity] channel names` log via
     `VERCEL_TOKEN="$(vercel-token)" vercel logs --environment production --since 30m -q "discord-activity" -x`.
     Expect a few slow lines right after a deploy, then none, once the KV cache from Fix 2 is in.
   - In a browser (incognito, then signed in), on DevTools Network with the cache disabled:
     there should be no `/api/profile-summary` request on load (after Fix 6), and the
     attendance, passport and vouches sections should paint with the HTML.
   - Vercel Speed Insights / Observability: watch the p75/p95 for `/profile/[id]` and the
     function cold-start count over a week of normal deploys.
5. **Regression checks**:
   - The owner sees the Edit dock and banner, and `?as=visitor` hides them.
   - Discord activity still shows channel names only for public channels.
   - The OpenGraph tags are still present (curl the HTML `<meta property="og:title">`).
   - The hover card is unaffected.
