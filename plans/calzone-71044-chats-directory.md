# calzone-71044 — Global Pizza Party Telegram chat directory (`/chats`)

## Goal
A public page at `/chats` listing the Telegram chat link for every Global Pizza Party
city, with a search bar and region filter. Each city is deep-linkable at
`/chats/{city}`, which redirects straight to that city's Telegram chat.

## Data source (cross-database)
The chat data does **not** live in the onboarding app's database (Neon/Prisma). It
lives in the **rsvpizza Supabase** project:

- Project URL: `https://znpiwdvvsqaxuskpfleo.supabase.co`
- Table: `public.city_telegram_groups` — **546 rows, 513 with a `chat_url`**, 14 regions, 168 countries
- RLS is **disabled** on the table → the publishable (anon) key can read it directly.
- Relevant columns: `city_key` (unique, lowercase, e.g. `"addis ababa"`), `chat_url`
  (`https://t.me/+...`, nullable), `title` (mostly null), `country`, `region`
  (slugs like `western-europe`, `west-africa`, `india`, `usa`), `is_supergroup`.

We read it over Supabase's PostgREST endpoint with a plain `fetch` — **no new npm
dependency**:

```
GET https://znpiwdvvsqaxuskpfleo.supabase.co/rest/v1/city_telegram_groups
    ?select=city_key,chat_url,title,country,region,is_supergroup
    &chat_url=not.is.null
    &order=city_key.asc
Headers: apikey: <publishable key>, Authorization: Bearer <publishable key>
```

### Env vars (add to `.env.local` + Vercel: production, preview, dev)
- `RSVPIZZA_SUPABASE_URL=https://znpiwdvvsqaxuskpfleo.supabase.co`
- `RSVPIZZA_SUPABASE_ANON_KEY=sb_publishable_3DS3FFCDtXxCRySfY-nvSw_dJL2aY3T`

(Publishable key, read-only against an RLS-free public reference table — safe to use
server-side. Routes still only ever return public fields.)

## Decisions (confirmed)
- **Logged-in users only** — both pages and the API route require an authenticated session.
- **Detail page = auto-redirect** to the Telegram link (no interstitial).
- **Hide** the 33 cities with no link — only the 513 linked cities are listed.
- **Region filter chips** (14 regions) alongside a city search box.

## Auth gating (logged-in only)
Uses the app's existing Discord-OAuth session (`app/lib/session.ts` + `useSession`).
- **`/api/chats`**: `const session = await getSession(); if (!session?.discordId) return 401`.
  Because it's now auth-gated, use `Cache-Control: private, max-age=300` (not `public`).
- **`/chats/page.tsx`** (client): `const { data: session, isLoading } = useSession()`;
  in an effect, `if (!isLoading && !session?.authenticated) router.push('/api/discord/login')`.
  Show a loading state while `isLoading`; render nothing if unauthenticated.
- **`/chats/[city]/page.tsx`** (server): `const session = await getSession();`
  `if (!session?.discordId) redirect('/api/discord/login')` **before** the Telegram redirect,
  so the redirect endpoint itself is protected too.

## Implementation

### 1. `app/lib/chats.ts` (new)
- `getCityChats()`: fetches the PostgREST URL above, maps each row to
  `{ slug, name, chatUrl, country, region, isSupergroup }`.
  - `slug` = slugify(`city_key`): lowercase, strip leading non-alphanumerics
    (handles dirty keys like `"- nashville"`), spaces → hyphens, collapse repeats.
  - `name` = display form of `city_key`: trim leading punctuation, title-case
    (fall back to `title` if ever present).
- Dedup slugs defensively (keep first); drop any row whose `chat_url` is somehow null.
- In-memory cache (~30 min TTL) following the Phase-5 caching pattern already in the
  repo, so we don't hit Supabase on every request.
- `getCityChatBySlug(slug)`: look up within the cached list.

### 2. `app/api/chats/route.ts` (new)
- **Auth guard first**: `getSession()` → 401 if no `session.discordId`.
- `GET` returns `{ cities: [{ slug, name, country, region, isSupergroup }], regions: [{ id, count }] }`.
  (List payload omits `chatUrl`; cards link through `/chats/{slug}`.)
- 513 rows is small → return the full list; filtering/search happens client-side.
- `Cache-Control: private, max-age=300` (auth-gated, so not a public/shared cache).
- Wrap in the repo's `withErrorHandling` helper.

### 3. `app/chats/page.tsx` (new, `"use client"`)
- Guards with `useSession()`; redirects unauthenticated users to `/api/discord/login`.
- Fetches `/api/chats` once on mount (only when authenticated).
- Search box (350ms debounce) filtering by city name; region filter chips with
  per-region counts plus an "All" chip (mirrors the crew page's chip pattern).
- Responsive card grid (`repeat(auto-fill, minmax(240px, 1fr))`), inline styles +
  CSS variables, theme-aware — consistent with `app/crew/page.tsx` and `app/articles`.
- Each card shows city name + region/country and links to `/chats/{slug}`
  (`target="_blank"`), plus a small "supergroup" hint where relevant.
- Hero header ("Find your city's Pizza Party chat") + result count.

### 4. `app/chats/[city]/page.tsx` (new, async server component)
- **Auth guard first**: `getSession()` → `redirect('/api/discord/login')` if not logged in.
- `const { city } = await params`; `getCityChatBySlug(city)`.
- Found → `redirect(chatUrl)` (`next/navigation`).
- Not found → `redirect('/chats')` (or `notFound()`).

### 5. Discoverability (optional, confirm)
- Add a `/chats` link to the main nav / dashboard so members can find it.

## Files
- New: `app/lib/chats.ts`, `app/api/chats/route.ts`, `app/chats/page.tsx`,
  `app/chats/[city]/page.tsx`
- Modified: `.env.local` (+ Vercel env via CLI); optionally a nav/dashboard file
- Plan: this file

## Verification (worktree + draft PR → Vercel preview)
1. The two `RSVPIZZA_*` env vars are already set on Vercel (production/preview/development).
2. Logged out: visiting `/chats` redirects to `/api/discord/login`; `GET /api/chats` returns 401;
   `/chats/austin` redirects to login. Logged in: all work normally.
3. `/chats` lists ~513 cities; search narrows by name; region chips filter correctly.
3. Clicking a card opens the city's Telegram chat.
4. `/chats/austin` (and a multi-word slug like `/chats/addis-ababa`) redirects to Telegram.
5. Unknown slug `/chats/zzz` redirects back to `/chats`.
6. `npm run build` clean (ignoring the known pre-existing `ProjectCard.test.tsx` TS error).

## Notes / risks
- Data quality in source: some dirty `city_key`s (`"- nashville"`) and a few
  `country` fields holding city names — cosmetic only; slug/name normalization handles them.
- Cross-project coupling: onboarding now reads rsvpizza's Supabase. If that table is
  renamed/locked down (RLS turned on), `/chats` breaks — documented here as a dependency.
